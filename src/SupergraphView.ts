import { ItemView, TFile, WorkspaceLeaf, debounce } from 'obsidian';
import cytoscape, { Core, EventObject } from 'cytoscape';
// @ts-ignore - no types available
import cola from 'cytoscape-cola';
import { GraphState, GraphNode, GraphEdge } from './types';
import SupergraphPlugin from '../main';

cytoscape.use(cola);

export const VIEW_TYPE_SUPERGRAPH = 'supergraph-view';

// Display settings with defaults
interface DisplaySettings {
	nodeSize: number;
	linkThickness: number;
	showArrows: boolean;
	textFadeThreshold: number;
	showOrphans: boolean;
}

// Force settings with defaults
interface ForceSettings {
	centerForce: number;
	repelForce: number;
	linkForce: number;
	linkDistance: number;
}

const DEFAULT_DISPLAY: DisplaySettings = {
	nodeSize: 10,
	linkThickness: 1,
	showArrows: false,
	textFadeThreshold: 0.5,
	showOrphans: true
};

const DEFAULT_FORCES: ForceSettings = {
	centerForce: 0.3,
	repelForce: 30,
	linkForce: 0.5,
	linkDistance: 80
};

export class SupergraphView extends ItemView {
	private cy: Core | null = null;
	private plugin: SupergraphPlugin;
	private graphContainer: HTMLElement | null = null;
	private saveGraphStateDebounced: () => void;
	private layout: cytoscape.Layouts | null = null;
	private settingsPanel: HTMLElement | null = null;
	private display: DisplaySettings = { ...DEFAULT_DISPLAY };
	private forces: ForceSettings = { ...DEFAULT_FORCES };
	private centerForceInterval: number | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: SupergraphPlugin) {
		super(leaf);
		this.plugin = plugin;
		// Debounce save operations to avoid excessive writes
		this.saveGraphStateDebounced = debounce(() => this.saveGraphState(), 500, true);
	}

	getViewType(): string {
		return VIEW_TYPE_SUPERGRAPH;
	}

	getDisplayText(): string {
		return 'Supergraph';
	}

	getIcon(): string {
		return 'git-fork';
	}

	async onOpen(): Promise<void> {
		const container = this.containerEl.children[1];
		container.empty();
		container.addClass('supergraph-view-container');

		// Create main wrapper for graph and settings
		const wrapper = container.createDiv({ cls: 'supergraph-wrapper' });

		// Graph canvas
		this.graphContainer = wrapper.createDiv({ cls: 'supergraph-canvas' });

		// Settings panel (right side)
		this.settingsPanel = wrapper.createDiv({ cls: 'supergraph-settings' });
		this.buildSettingsPanel();

		await this.initializeGraph();
		await this.loadGraphData();
	}

	private buildSettingsPanel(): void {
		if (!this.settingsPanel) return;

		// Header with reset view and reset settings buttons
		const header = this.settingsPanel.createDiv({ cls: 'settings-header' });
		header.createSpan({ text: 'Settings', cls: 'settings-title' });
		const headerActions = header.createDiv({ cls: 'settings-header-actions' });

		const resetViewBtn = headerActions.createEl('button', { cls: 'settings-reset-btn', attr: { 'aria-label': 'Reset view' } });
		resetViewBtn.innerHTML = '&#8962;'; // Home icon
		resetViewBtn.addEventListener('click', () => this.resetView());

		const resetSettingsBtn = headerActions.createEl('button', { cls: 'settings-reset-btn', attr: { 'aria-label': 'Reset settings' } });
		resetSettingsBtn.innerHTML = '&#8635;'; // Refresh icon
		resetSettingsBtn.addEventListener('click', () => this.resetSettings());

		// Search
		const searchContainer = this.settingsPanel.createDiv({ cls: 'settings-search' });
		const searchInput = searchContainer.createEl('input', {
			type: 'text',
			placeholder: 'Search files...',
			cls: 'settings-search-input'
		});
		searchInput.addEventListener('input', (e) => {
			this.plugin.settings.fileFilter = (e.target as HTMLInputElement).value;
			this.loadGraphData();
		});

		// Filters section
		this.createCollapsibleSection('Filters', (content) => {
			this.createToggle(content, 'Orphans', this.display.showOrphans, (val) => {
				this.display.showOrphans = val;
				this.loadGraphData();
			});
		}, true);

		// Display section
		this.createCollapsibleSection('Display', (content) => {
			this.createToggle(content, 'Arrows', this.display.showArrows, (val) => {
				this.display.showArrows = val;
				this.updateStyles();
			});

			this.createSlider(content, 'Text fade threshold', 0, 2, 0.1, this.display.textFadeThreshold, (val) => {
				this.display.textFadeThreshold = val;
				this.updateStyles();
			});

			this.createSlider(content, 'Node size', 3, 30, 1, this.display.nodeSize, (val) => {
				this.display.nodeSize = val;
				this.updateStyles();
			});

			this.createSlider(content, 'Link thickness', 0.5, 5, 0.5, this.display.linkThickness, (val) => {
				this.display.linkThickness = val;
				this.updateStyles();
			});

			// Animate button
			const animateBtn = content.createEl('button', { text: 'Animate', cls: 'settings-animate-btn' });
			animateBtn.addEventListener('click', () => this.runLayout());
		}, true);

		// Forces section
		this.createCollapsibleSection('Forces', (content) => {
			this.createSlider(content, 'Center force', 0, 1, 0.05, this.forces.centerForce, (val) => {
				this.forces.centerForce = val;
				this.restartLayout();
			});

			this.createSlider(content, 'Repel force', 0, 200, 5, this.forces.repelForce, (val) => {
				this.forces.repelForce = val;
				this.restartLayout();
			});

			this.createSlider(content, 'Link force', 0, 2, 0.1, this.forces.linkForce, (val) => {
				this.forces.linkForce = val;
				this.restartLayout();
			});

			this.createSlider(content, 'Link distance', 30, 300, 10, this.forces.linkDistance, (val) => {
				this.forces.linkDistance = val;
				this.restartLayout();
			});
		}, true);
	}

	private createCollapsibleSection(title: string, buildContent: (container: HTMLElement) => void, expanded = false): void {
		if (!this.settingsPanel) return;

		const section = this.settingsPanel.createDiv({ cls: 'settings-section' });
		const headerEl = section.createDiv({ cls: 'settings-section-header' });
		const arrow = headerEl.createSpan({ cls: 'settings-section-arrow' });
		arrow.innerHTML = expanded ? '&#9662;' : '&#9656;';
		headerEl.createSpan({ text: title });

		const content = section.createDiv({ cls: 'settings-section-content' });
		if (!expanded) content.style.display = 'none';

		buildContent(content);

		headerEl.addEventListener('click', () => {
			const isHidden = content.style.display === 'none';
			content.style.display = isHidden ? 'block' : 'none';
			arrow.innerHTML = isHidden ? '&#9662;' : '&#9656;';
		});
	}

	private createToggle(container: HTMLElement, label: string, value: boolean, onChange: (val: boolean) => void): void {
		const row = container.createDiv({ cls: 'settings-row' });
		row.createSpan({ text: label, cls: 'settings-label' });

		const toggle = row.createDiv({ cls: `settings-toggle ${value ? 'is-enabled' : ''}` });
		const toggleThumb = toggle.createDiv({ cls: 'settings-toggle-thumb' });

		toggle.addEventListener('click', () => {
			const newVal = !toggle.hasClass('is-enabled');
			toggle.toggleClass('is-enabled', newVal);
			onChange(newVal);
		});
	}

	private createSlider(container: HTMLElement, label: string, min: number, max: number, step: number, value: number, onChange: (val: number) => void): void {
		const row = container.createDiv({ cls: 'settings-row settings-row-vertical' });
		row.createSpan({ text: label, cls: 'settings-label' });

		const slider = row.createEl('input', {
			type: 'range',
			cls: 'settings-slider'
		});
		slider.min = String(min);
		slider.max = String(max);
		slider.step = String(step);
		slider.value = String(value);

		slider.addEventListener('input', (e) => {
			onChange(parseFloat((e.target as HTMLInputElement).value));
		});
	}

	private resetSettings(): void {
		this.display = { ...DEFAULT_DISPLAY };
		this.forces = { ...DEFAULT_FORCES };
		this.plugin.settings.fileFilter = '';

		// Rebuild panel
		if (this.settingsPanel) {
			this.settingsPanel.empty();
			this.buildSettingsPanel();
		}

		this.updateStyles();
		this.loadGraphData();
	}

	private updateStyles(): void {
		if (!this.cy) return;

		this.cy.style()
			.selector('node')
			.style({
				'width': this.display.nodeSize,
				'height': this.display.nodeSize,
				'text-opacity': this.cy.zoom() > this.display.textFadeThreshold ? 1 : 0
			})
			.selector('edge')
			.style({
				'width': this.display.linkThickness,
				'target-arrow-shape': this.display.showArrows ? 'triangle' : 'none'
			})
			.update();
	}

	private restartLayout(): void {
		if (this.layout) {
			this.layout.stop();
		}
		this.startForceLayout();
	}

	async onClose(): Promise<void> {
		await this.saveGraphState();
		if (this.centerForceInterval) {
			window.clearInterval(this.centerForceInterval);
			this.centerForceInterval = null;
		}
		if (this.layout) {
			this.layout.stop();
			this.layout = null;
		}
		if (this.cy) {
			this.cy.destroy();
			this.cy = null;
		}
	}

	private async initializeGraph(): Promise<void> {
		if (!this.graphContainer) return;

		this.cy = cytoscape({
			container: this.graphContainer,
			style: [
				{
					selector: 'node',
					style: {
						'background-color': 'var(--interactive-accent)',
						'label': 'data(label)',
						'width': 10,
						'height': 10,
						'font-size': 11,
						'text-valign': 'bottom',
						'text-halign': 'center',
						'text-margin-y': 5,
						'color': 'var(--text-muted)',
						'shape': 'ellipse'
					}
				},
				{
					selector: 'edge',
					style: {
						'width': 2,
						'line-color': 'var(--background-modifier-border)',
						'target-arrow-color': 'var(--background-modifier-border)',
						'target-arrow-shape': 'triangle',
						'curve-style': 'bezier'
					}
				},
				{
					selector: 'edge.manual',
					style: {
						'line-color': 'var(--interactive-accent)',
						'target-arrow-color': 'var(--interactive-accent)',
						'line-style': 'dashed'
					}
				}
			],
			layout: {
				name: 'preset'
			},
			wheelSensitivity: 0.3
		});

		// Save positions when nodes are dragged (debounced to avoid excessive saves)
		this.cy.on('dragfree', 'node', () => {
			this.saveGraphStateDebounced();
		});

		// Open file on node tap
		this.cy.on('tap', 'node', (evt: EventObject) => {
			const node = evt.target;
			const fileId = node.id();
			this.openFile(fileId);
		});

		// Save state on pan (debounced to avoid excessive saves)
		this.cy.on('pan', () => {
			this.saveGraphStateDebounced();
		});
	}

	private async loadGraphData(): Promise<void> {
		const files = this.app.vault.getMarkdownFiles();
		const nodes: GraphNode[] = [];
		const edges: GraphEdge[] = [];

		// Create nodes from files
		for (const file of files) {
			if (this.shouldIncludeFile(file)) {
				nodes.push(this.createNodeFromFile(file));
			}
		}

		// Create edges from links
		if (this.plugin.settings.showLinks) {
			for (const file of files) {
				const cache = this.app.metadataCache.getFileCache(file);
				if (cache?.links) {
					for (const link of cache.links) {
						const targetFile = this.app.metadataCache.getFirstLinkpathDest(
							link.link,
							file.path
						);
						if (targetFile) {
							edges.push({
								id: `${file.path}->${targetFile.path}`,
								source: file.path,
								target: targetFile.path
							});
						}
					}
				}
			}
		}

		// Load saved state
		const savedState = await this.loadGraphState();
		
		// Merge positions from saved state
		if (savedState) {
			nodes.forEach(node => {
				const savedNode = savedState.nodes.find(n => n.id === node.id);
				if (savedNode?.position) {
					node.position = savedNode.position;
				}
			});

			// Add manual edges
			savedState.edges.forEach(edge => {
				if (edge.isManual && !edges.find(e => e.id === edge.id)) {
					edges.push(edge);
				}
			});
		}

		this.renderGraph(nodes, edges, savedState);
	}

	private shouldIncludeFile(file: TFile): boolean {
		if (!this.plugin.settings.showAllFiles) {
			return false;
		}

		const filter = this.plugin.settings.fileFilter.trim();
		if (filter && !file.path.toLowerCase().includes(filter.toLowerCase())) {
			return false;
		}

		return true;
	}

	private createNodeFromFile(file: TFile): GraphNode {
		return {
			id: file.path,
			label: file.basename,
			snippet: ''
		};
	}

	private renderGraph(nodes: GraphNode[], edges: GraphEdge[], savedState: GraphState | null): void {
		if (!this.cy) return;

		// Check if all nodes have saved positions
		const allNodesHavePositions = nodes.length > 0 && nodes.every(n => n.position);

		// Get center of the viewport for initial positioning
		const containerWidth = this.graphContainer?.clientWidth || 800;
		const containerHeight = this.graphContainer?.clientHeight || 600;
		const centerX = containerWidth / 2;
		const centerY = containerHeight / 2;

		const elements = [
			...nodes.map(node => {
				// If we have saved position, use it. Otherwise start from center with slight random offset
				let position = node.position;
				if (!position) {
					// Small random offset from center (within 20px) for initial "explosion" effect
					position = {
						x: centerX + (Math.random() - 0.5) * 40,
						y: centerY + (Math.random() - 0.5) * 40
					};
				}
				return {
					data: {
						id: node.id,
						label: node.label,
						snippet: node.snippet
					},
					position
				};
			}),
			...edges.map(edge => ({
				data: {
					id: edge.id,
					source: edge.source,
					target: edge.target
				},
				classes: edge.isManual ? 'manual' : ''
			}))
		];

		this.cy.elements().remove();
		this.cy.add(elements);

		// Enable dragging on all nodes after they are added
		this.cy.nodes().forEach(node => {
			node.grabify();
		});

		if (allNodesHavePositions && savedState?.zoom && savedState?.pan) {
			// Restore saved viewport
			this.cy.viewport({
				zoom: savedState.zoom,
				pan: savedState.pan
			});
		} else {
			// Fit to show all nodes initially
			this.cy.fit(undefined, 50);
		}

		// Always run the continuous force layout
		this.startForceLayout();
	}

	private startForceLayout(): void {
		if (!this.cy) return;

		// Stop existing layout if any
		if (this.layout) {
			this.layout.stop();
		}

		// Calculate edge length based on link distance and link force
		const edgeLength = this.forces.linkDistance * (1 + (1 - this.forces.linkForce));

		this.layout = this.cy.layout({
			name: 'cola',
			animate: true,
			infinite: true,
			fit: false,
			randomize: false,
			nodeSpacing: this.forces.repelForce,
			edgeLength: edgeLength,
			handleDisconnected: true,
			convergenceThreshold: 0.0001,
			// @ts-ignore - cola specific options
			avoidOverlap: true,
			unconstrIter: 20,
			userConstIter: 0,
			allConstIter: 20,
		} as cytoscape.LayoutOptions);

		this.layout.run();

		// Apply center force as a continuous gravity pull toward center
		this.applyCenterForce();
	}

	private applyCenterForce(): void {
		// Clear any existing interval
		if (this.centerForceInterval) {
			window.clearInterval(this.centerForceInterval);
			this.centerForceInterval = null;
		}

		if (!this.cy || this.forces.centerForce <= 0.01) return;

		// Get viewport center
		const extent = this.cy.extent();
		const centerX = (extent.x1 + extent.x2) / 2;
		const centerY = (extent.y1 + extent.y2) / 2;

		// Apply gentle pull toward center every frame
		this.centerForceInterval = window.setInterval(() => {
			if (!this.cy) {
				if (this.centerForceInterval) window.clearInterval(this.centerForceInterval);
				return;
			}

			const strength = this.forces.centerForce * 0.02; // Very gentle pull

			this.cy.nodes().forEach(node => {
				const pos = node.position();
				const dx = centerX - pos.x;
				const dy = centerY - pos.y;

				// Apply small force toward center
				node.position({
					x: pos.x + dx * strength,
					y: pos.y + dy * strength
				});
			});
		}, 50); // 20fps for smooth but not CPU-intensive animation
	}

	private async openFile(filePath: string): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (file instanceof TFile) {
			const leaf = this.app.workspace.getLeaf(false);
			await leaf.openFile(file);
		}
	}

	private async saveGraphState(): Promise<void> {
		if (!this.cy) return;

		const nodes: GraphNode[] = [];
		const edges: GraphEdge[] = [];

		this.cy.nodes().forEach(node => {
			const pos = node.position();
			nodes.push({
				id: node.id(),
				label: node.data('label'),
				snippet: node.data('snippet'),
				position: { x: pos.x, y: pos.y }
			});
		});

		this.cy.edges().forEach(edge => {
			edges.push({
				id: edge.id(),
				source: edge.data('source'),
				target: edge.data('target'),
				isManual: edge.hasClass('manual')
			});
		});

		const state: GraphState = {
			nodes,
			edges,
			zoom: this.cy.zoom(),
			pan: this.cy.pan()
		};

		await this.plugin.saveData({ graphState: state });
	}

	private async loadGraphState(): Promise<GraphState | null> {
		const data = await this.plugin.loadData();
		return data?.graphState || null;
	}

	async refreshGraph(): Promise<void> {
		await this.loadGraphData();
	}

	private resetView(): void {
		if (!this.cy) return;
		this.cy.fit();
		this.saveGraphStateDebounced();
	}

	private runLayout(): void {
		this.startForceLayout();
	}
}

import { ItemView, TFile, WorkspaceLeaf } from 'obsidian';
import cytoscape, { Core, EventObject } from 'cytoscape';
import { GraphState, GraphNode, GraphEdge } from './types';
import SupergraphPlugin from '../main';

export const VIEW_TYPE_SUPERGRAPH = 'supergraph-view';

export class SupergraphView extends ItemView {
	private cy: Core | null = null;
	private plugin: SupergraphPlugin;
	private graphContainer: HTMLElement | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: SupergraphPlugin) {
		super(leaf);
		this.plugin = plugin;
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

		this.graphContainer = container.createDiv({ cls: 'supergraph-canvas' });
		
		await this.initializeGraph();
		await this.loadGraphData();
	}

	async onClose(): Promise<void> {
		await this.saveGraphState();
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
						'width': 'mapData(zoom, 0, 1, 20, 200)',
						'height': 'mapData(zoom, 0, 1, 20, 150)',
						'font-size': 'mapData(zoom, 0, 1, 0, 14)',
						'text-valign': 'top',
						'text-halign': 'center',
						'text-wrap': 'wrap',
						'text-max-width': '180px',
						'color': 'var(--text-normal)',
						'shape': 'roundrectangle',
						'border-width': 2,
						'border-color': 'var(--background-modifier-border)'
					}
				},
				{
					selector: 'node[snippet]',
					style: {
						'label': function(ele: cytoscape.NodeSingular) {
							const zoom = ele.cy().zoom();
							if (zoom < 0.5) {
								return '';
							} else if (zoom < 1.0) {
								return ele.data('label');
							} else {
								return ele.data('label') + '\n' + ele.data('snippet');
							}
						}
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
				name: 'cose',
				animate: false,
				randomize: false
			}
		});

		// Enable dragging
		this.cy.nodes().forEach(node => {
			node.grabify();
		});

		// Save positions when nodes are dragged
		this.cy.on('dragfree', 'node', () => {
			this.saveGraphState();
		});

		// Open file on node tap
		this.cy.on('tap', 'node', (evt: EventObject) => {
			const node = evt.target;
			const fileId = node.id();
			this.openFile(fileId);
		});

		// Update labels on zoom
		this.cy.on('zoom', () => {
			if (this.cy) {
				this.cy.nodes().forEach(node => {
					node.data('zoom', this.cy?.zoom() || 1);
				});
			}
		});

		// Save state on pan
		this.cy.on('pan', () => {
			this.saveGraphState();
		});
	}

	private async loadGraphData(): Promise<void> {
		const files = this.app.vault.getMarkdownFiles();
		const nodes: GraphNode[] = [];
		const edges: GraphEdge[] = [];

		// Create nodes from files
		for (const file of files) {
			if (this.shouldIncludeFile(file)) {
				const node = await this.createNodeFromFile(file);
				nodes.push(node);
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

	private async createNodeFromFile(file: TFile): Promise<GraphNode> {
		const content = await this.app.vault.read(file);
		const firstLine = content.split('\n')[0] || file.basename;
		
		// Remove markdown heading syntax
		const title = firstLine.replace(/^#+\s*/, '').trim() || file.basename;
		
		// Get snippet (first non-empty paragraph)
		const lines = content.split('\n');
		let snippet = '';
		for (const line of lines.slice(1)) {
			const trimmed = line.trim();
			if (trimmed && !trimmed.startsWith('#')) {
				snippet = trimmed;
				break;
			}
		}

		if (snippet.length > this.plugin.settings.maxSnippetLength) {
			snippet = snippet.substring(0, this.plugin.settings.maxSnippetLength) + '...';
		}

		return {
			id: file.path,
			label: title,
			snippet: snippet
		};
	}

	private renderGraph(nodes: GraphNode[], edges: GraphEdge[], savedState: GraphState | null): void {
		if (!this.cy) return;

		const elements = [
			...nodes.map(node => ({
				data: {
					id: node.id,
					label: node.label,
					snippet: node.snippet,
					zoom: this.cy?.zoom() || 1
				},
				position: node.position
			})),
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

		if (savedState?.zoom && savedState?.pan) {
			this.cy.viewport({
				zoom: savedState.zoom,
				pan: savedState.pan
			});
		} else {
			this.cy.layout({
				name: 'cose',
				animate: true,
				animationDuration: 500,
				randomize: false,
				nodeRepulsion: 8000,
				idealEdgeLength: 100,
				edgeElasticity: 100
			}).run();
		}
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
}

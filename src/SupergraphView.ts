import { ItemView, TFile, WorkspaceLeaf, debounce, setIcon } from "obsidian";
import cytoscape, { Core, EventObject } from "cytoscape";
// @ts-ignore - no types available
import d3Force from "cytoscape-d3-force";
// @ts-ignore - no types available
import nodeHtmlLabel from "cytoscape-node-html-label";
import { GraphState, GraphNode, GraphEdge } from "./types";
import SupergraphPlugin from "../main";

cytoscape.use(d3Force);
nodeHtmlLabel(cytoscape);

export const VIEW_TYPE_SUPERGRAPH = "supergraph-view";

/**
 * Physics constants for the d3-force simulation.
 *
 * These constants are NOT user-configurable. They define the underlying physics
 * behavior and are multiplied with user settings (DEFAULT_FORCES) to produce
 * the final force values.
 *
 * Final force calculation examples:
 *   - repelStrength = -repelForce * REPEL_MULTIPLIER     (e.g., -4 * 60 = -240)
 *   - centerStrength = centerForce * CENTER_MULTIPLIER  (e.g., 0.3 * 0.3 = 0.09)
 *   - linkStrength = linkForce * LINK_STRENGTH_MULTIPLIER (e.g., 0.3 * 0.3 = 0.09)
 *   - collideRadius = nodeSize * COLLIDE_RADIUS_MULTIPLIER (e.g., 10 * 2 = 20)
 */
const PHYSICS = {
	// Simulation parameters (control how the simulation runs)
	ALPHA_START: 1, // Initial energy of the simulation
	ALPHA_MIN: 0.01, // Minimum energy before simulation stops
	ALPHA_DECAY: 0.02, // How quickly simulation cools down (higher = faster settling)
	ALPHA_TARGET: 0, // Target energy (0 = simulation settles to rest)
	VELOCITY_DECAY: 0.4, // Friction - higher = more damping

	// Force multipliers (scale user-configurable slider values to d3-force values)
	REPEL_MULTIPLIER: 60, // Multiplied with repelForce for manyBodyStrength
	CENTER_MULTIPLIER: 0.3, // Multiplied with centerForce for x/yStrength
	LINK_STRENGTH_MULTIPLIER: 0.3, // Multiplied with linkForce for linkStrength
	COLLIDE_RADIUS_MULTIPLIER: 2, // Multiplied with nodeSize for collision radius

	// Force limits (hard constraints on the simulation)
	MANY_BODY_DISTANCE_MIN: 10, // Minimum distance for repulsion calculation
	MANY_BODY_DISTANCE_MAX: 1000, // Maximum distance for repulsion effect
	MIN_LINK_DISTANCE: 30, // Minimum edge length (prevents nodes from overlapping)
	COLLIDE_STRENGTH: 1, // How strongly nodes avoid overlapping (0-1)

	// Initial node positioning
	INITIAL_SPREAD: 40, // Random spread (px) when nodes start from center
	FIT_PADDING: 50, // Padding (px) when fitting graph to viewport

	// Viewport defaults
	DEFAULT_WIDTH: 800,
	DEFAULT_HEIGHT: 600,
};

// Display settings - user-configurable via UI sliders
interface DisplaySettings {
	nodeSize: number;
	linkThickness: number;
	showArrows: boolean;
	showOrphans: boolean;
	cardWidth: number;
	cardHeight: number;
	snippetLength: number;
}

/**
 * Force settings - user-configurable via UI sliders.
 *
 * These values are multiplied with PHYSICS constants to produce final d3-force values:
 *   - centerForce: Pull toward center (0 = none, 1 = strong)
 *   - repelForce: Push nodes apart (0 = none, higher = stronger repulsion)
 *   - linkForce: How strongly edges pull connected nodes together (0-2)
 *   - linkDistance: Target distance between connected nodes (px)
 */
interface ForceSettings {
	centerForce: number;
	repelForce: number;
	linkForce: number;
	linkDistance: number;
}

const DEFAULT_DISPLAY: DisplaySettings = {
	nodeSize: 15,
	linkThickness: 3,
	showArrows: true,
	showOrphans: true,
	cardWidth: 200,
	cardHeight: 120,
	snippetLength: 150,
};

const DEFAULT_FORCES: ForceSettings = {
	centerForce: 0.3, // Moderate pull toward center
	repelForce: 30, // Results in manyBodyStrength of -240 (4 * 60)
	linkForce: 0.3, // Results in linkStrength of 0.09 (0.3 * 0.3)
	linkDistance: 100, // Target 80px between connected nodes
};

export class SupergraphView extends ItemView {
	private cy: Core | null = null;
	private plugin: SupergraphPlugin;
	private graphContainer: HTMLElement | null = null;
	private saveGraphStateDebounced: () => void;
	private saveViewSettingsDebounced: () => void;
	private layout: cytoscape.Layouts | null = null;
	private settingsPanel: HTMLElement | null = null;
	private settingsToggle: HTMLElement | null = null;
	private display: DisplaySettings = { ...DEFAULT_DISPLAY };
	private forces: ForceSettings = { ...DEFAULT_FORCES };

	constructor(leaf: WorkspaceLeaf, plugin: SupergraphPlugin) {
		super(leaf);
		this.plugin = plugin;
		// Debounce save operations to avoid excessive writes
		this.saveGraphStateDebounced = debounce(
			() => this.saveGraphState(),
			500,
			true,
		);
		this.saveViewSettingsDebounced = debounce(
			() => this.saveViewSettings(),
			300,
			true,
		);
	}

	getViewType(): string {
		return VIEW_TYPE_SUPERGRAPH;
	}

	getDisplayText(): string {
		return "Supergraph";
	}

	getIcon(): string {
		return "git-fork";
	}

	async onOpen(): Promise<void> {
		// Load saved view settings first
		await this.loadViewSettings();

		const container = this.containerEl.children[1];
		container.empty();
		container.addClass("supergraph-view-container");

		// Create main wrapper for graph and settings
		const wrapper = container.createDiv({ cls: "supergraph-wrapper" });

		// Graph canvas
		this.graphContainer = wrapper.createDiv({ cls: "supergraph-canvas" });

		// Settings toggle button
		this.settingsToggle = wrapper.createDiv({
			cls: "supergraph-settings-toggle is-active",
		});
		setIcon(this.settingsToggle, "settings");
		this.settingsToggle.addEventListener("click", () =>
			this.toggleSettings(),
		);

		// Floating settings panel
		this.settingsPanel = wrapper.createDiv({ cls: "supergraph-settings" });
		this.buildSettingsPanel();

		await this.initializeGraph();
		await this.loadGraphData();
	}

	private toggleSettings(): void {
		if (!this.settingsPanel || !this.settingsToggle) return;

		const isHidden = this.settingsPanel.hasClass("is-hidden");
		this.settingsPanel.toggleClass("is-hidden", !isHidden);
		this.settingsToggle.toggleClass("is-active", isHidden);
	}

	private buildSettingsPanel(): void {
		if (!this.settingsPanel) return;

		// Header with reset view, reset settings, and close buttons
		const header = this.settingsPanel.createDiv({ cls: "settings-header" });
		header.createSpan({ text: "Filters", cls: "settings-title" });
		const headerActions = header.createDiv({
			cls: "settings-header-actions",
		});

		const resetViewBtn = headerActions.createEl("button", {
			cls: "settings-reset-btn clickable-icon",
			attr: { "aria-label": "Reset view" },
		});
		setIcon(resetViewBtn, "home");
		resetViewBtn.addEventListener("click", () => this.resetView());

		const resetSettingsBtn = headerActions.createEl("button", {
			cls: "settings-reset-btn clickable-icon",
			attr: { "aria-label": "Reset settings" },
		});
		setIcon(resetSettingsBtn, "rotate-ccw");
		resetSettingsBtn.addEventListener("click", () => this.resetSettings());

		const closeBtn = headerActions.createEl("button", {
			cls: "settings-reset-btn clickable-icon",
			attr: { "aria-label": "Close" },
		});
		setIcon(closeBtn, "x");
		closeBtn.addEventListener("click", () => this.toggleSettings());

		// Search
		const searchContainer = this.settingsPanel.createDiv({
			cls: "settings-search",
		});
		const searchInput = searchContainer.createEl("input", {
			type: "text",
			placeholder: "Search files...",
			cls: "settings-search-input",
			value: this.plugin.settings.fileFilter || "",
		});
		searchInput.addEventListener("input", (e) => {
			this.plugin.settings.fileFilter = (
				e.target as HTMLInputElement
			).value;
			this.loadGraphData();
		});

		// Filters section
		this.createCollapsibleSection(
			"Filters",
			(content) => {
				this.createToggle(
					content,
					"Orphans",
					this.display.showOrphans,
					(val) => {
						this.display.showOrphans = val;
						this.loadGraphData();
					},
				);
			},
			true,
		);

		// Display section
		this.createCollapsibleSection(
			"Display",
			(content) => {
				this.createToggle(
					content,
					"Arrows",
					this.display.showArrows,
					(val) => {
						this.display.showArrows = val;
						this.updateStyles();
					},
				);

				this.createSlider(
					content,
					"Card width",
					100,
					400,
					10,
					this.display.cardWidth,
					DEFAULT_DISPLAY.cardWidth,
					(val) => {
						this.display.cardWidth = val;
						this.updateStyles();
						// Reload graph to update HTML labels
						this.loadGraphData();
					},
				);

				this.createSlider(
					content,
					"Card height",
					60,
					300,
					10,
					this.display.cardHeight,
					DEFAULT_DISPLAY.cardHeight,
					(val) => {
						this.display.cardHeight = val;
						this.updateStyles();
						// Reload graph to update HTML labels
						this.loadGraphData();
					},
				);

				this.createSlider(
					content,
					"Snippet length",
					50,
					500,
					10,
					this.display.snippetLength,
					DEFAULT_DISPLAY.snippetLength,
					(val) => {
						this.display.snippetLength = val;
						// Reload graph to update snippets
						this.loadGraphData();
					},
				);

				this.createSlider(
					content,
					"Link thickness",
					0.1,
					5,
					0.1,
					this.display.linkThickness,
					DEFAULT_DISPLAY.linkThickness,
					(val) => {
						this.display.linkThickness = val;
						this.updateStyles();
					},
				);

				// Animate button
				const animateBtn = content.createEl("button", {
					text: "Animate",
					cls: "settings-animate-btn",
				});
				animateBtn.addEventListener("click", () => this.runLayout());
			},
			true,
		);

		// Forces section
		this.createCollapsibleSection(
			"Forces",
			(content) => {
				this.createSlider(
					content,
					"Center force",
					0,
					1,
					0.05,
					this.forces.centerForce,
					DEFAULT_FORCES.centerForce,
					(val) => {
						this.forces.centerForce = val;
						this.restartLayout();
					},
				);

				this.createSlider(
					content,
					"Repel force",
					0,
					50,
					1,
					this.forces.repelForce,
					DEFAULT_FORCES.repelForce,
					(val) => {
						this.forces.repelForce = val;
						this.restartLayout();
					},
				);

				this.createSlider(
					content,
					"Link force",
					0,
					2,
					0.1,
					this.forces.linkForce,
					DEFAULT_FORCES.linkForce,
					(val) => {
						this.forces.linkForce = val;
						this.restartLayout();
					},
				);

				this.createSlider(
					content,
					"Link distance",
					30,
					300,
					10,
					this.forces.linkDistance,
					DEFAULT_FORCES.linkDistance,
					(val) => {
						this.forces.linkDistance = val;
						this.restartLayout();
					},
				);
			},
			true,
		);
	}

	private createCollapsibleSection(
		title: string,
		buildContent: (container: HTMLElement) => void,
		expanded = false,
	): void {
		if (!this.settingsPanel) return;

		const section = this.settingsPanel.createDiv({
			cls: "settings-section",
		});
		const headerEl = section.createDiv({ cls: "settings-section-header" });
		const arrow = headerEl.createSpan({ cls: "settings-section-arrow" });
		setIcon(arrow, expanded ? "chevron-down" : "chevron-right");
		headerEl.createSpan({ text: title });

		const content = section.createDiv({ cls: "settings-section-content" });
		if (!expanded) content.style.display = "none";

		buildContent(content);

		headerEl.addEventListener("click", () => {
			const isHidden = content.style.display === "none";
			content.style.display = isHidden ? "block" : "none";
			setIcon(arrow, isHidden ? "chevron-down" : "chevron-right");
		});
	}

	private createToggle(
		container: HTMLElement,
		label: string,
		value: boolean,
		onChange: (val: boolean) => void,
	): void {
		const row = container.createDiv({ cls: "settings-row" });
		row.createSpan({ text: label, cls: "settings-label" });

		const toggle = row.createDiv({
			cls: `settings-toggle ${value ? "is-enabled" : ""}`,
		});
		const toggleThumb = toggle.createDiv({ cls: "settings-toggle-thumb" });

		toggle.addEventListener("click", () => {
			const newVal = !toggle.hasClass("is-enabled");
			toggle.toggleClass("is-enabled", newVal);
			onChange(newVal);
		});
	}

	private createSlider(
		container: HTMLElement,
		label: string,
		min: number,
		max: number,
		step: number,
		value: number,
		defaultValue: number,
		onChange: (val: number) => void,
	): void {
		const row = container.createDiv({
			cls: "settings-row settings-row-vertical",
		});

		// Label row with current value and reset button
		const labelRow = row.createDiv({ cls: "settings-slider-label-row" });
		labelRow.createSpan({ text: label, cls: "settings-label" });

		const valueContainer = labelRow.createDiv({
			cls: "settings-slider-value-container",
		});
		const valueDisplay = valueContainer.createSpan({
			text: String(value),
			cls: "settings-slider-value",
		});
		valueContainer.createSpan({
			text: ` (${defaultValue})`,
			cls: "settings-slider-default",
		});

		// Reset to default button
		const resetBtn = valueContainer.createEl("button", {
			cls: "settings-slider-reset clickable-icon",
			attr: { "aria-label": "Reset to default" },
		});
		setIcon(resetBtn, "rotate-ccw");
		resetBtn.addEventListener("click", () => {
			slider.value = String(defaultValue);
			valueDisplay.setText(String(defaultValue));
			onChange(defaultValue);
			this.saveViewSettings();
		});

		const slider = row.createEl("input", {
			type: "range",
			cls: "settings-slider",
		});
		slider.min = String(min);
		slider.max = String(max);
		slider.step = String(step);
		slider.value = String(value);

		// Min/max labels
		const rangeLabels = row.createDiv({ cls: "settings-slider-range" });
		rangeLabels.createSpan({
			text: String(min),
			cls: "settings-slider-min",
		});
		rangeLabels.createSpan({
			text: String(max),
			cls: "settings-slider-max",
		});

		slider.addEventListener("input", (e) => {
			const newValue = parseFloat((e.target as HTMLInputElement).value);
			valueDisplay.setText(String(newValue));
			onChange(newValue);
			this.saveViewSettings();
		});
	}

	private resetSettings(): void {
		this.display = { ...DEFAULT_DISPLAY };
		this.forces = { ...DEFAULT_FORCES };
		// Don't clear the search filter - just reset display and force settings

		// Rebuild panel to update slider positions
		if (this.settingsPanel) {
			this.settingsPanel.empty();
			this.buildSettingsPanel();
		}

		this.updateStyles();
		this.restartLayout();
		this.saveViewSettings();
	}

	private updateStyles(): void {
		if (!this.cy) return;

		this.cy
			.style()
			.selector("node")
			.style({
				width: this.display.cardWidth,
				height: this.display.cardHeight,
			})
			.selector("edge")
			.style({
				width: this.display.linkThickness,
				"target-arrow-shape": this.display.showArrows
					? "triangle"
					: "none",
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
					selector: "node",
					style: {
						"background-color": "transparent",
						"background-opacity": 0,
						width: this.display.cardWidth,
						height: this.display.cardHeight,
						shape: "rectangle",
						// Hide the default label since we're using HTML labels
						label: "",
					},
				},
				{
					selector: "edge",
					style: {
						width: this.display.linkThickness,
						"line-color": "var(--background-modifier-border)",
						"target-arrow-color":
							"var(--background-modifier-border)",
						"target-arrow-shape": this.display.showArrows
							? "triangle"
							: "none",
						"curve-style": "bezier",
					},
				},
				{
					selector: "edge.manual",
					style: {
						"line-color": "var(--interactive-accent)",
						"target-arrow-color": "var(--interactive-accent)",
						"line-style": "dashed",
					},
				},
			],
			layout: {
				name: "preset",
			},
			wheelSensitivity: 0.3,
		});

		// Register HTML node labels for card rendering
		this.initializeNodeHtmlLabels();

		// Restart simulation when dragging starts (so other nodes react)
		this.cy.on("grab", "node", () => {
			this.restartLayout();
		});

		// Save positions when nodes are dragged (debounced to avoid excessive saves)
		this.cy.on("dragfree", "node", () => {
			this.saveGraphStateDebounced();
		});

		// Open file on node tap
		this.cy.on("tap", "node", (evt: EventObject) => {
			const node = evt.target;
			const fileId = node.id();
			this.openFile(fileId);
		});

		// Save state on pan (debounced to avoid excessive saves)
		this.cy.on("pan", () => {
			this.saveGraphStateDebounced();
		});
	}

	private initializeNodeHtmlLabels(): void {
		if (!this.cy) return;

		// @ts-ignore - nodeHtmlLabel extension
		this.cy.nodeHtmlLabel([
			{
				query: "node",
				halign: "center",
				valign: "center",
				halignBox: "center",
				valignBox: "center",
				tpl: (data: { id: string; label: string; snippet: string }) => {
					const escapedLabel = this.escapeHtml(data.label);
					const escapedSnippet = this.escapeHtml(data.snippet || "");
					return `
						<div class="supergraph-card" style="width: ${this.display.cardWidth}px; height: ${this.display.cardHeight}px;">
							<div class="supergraph-card-title">${escapedLabel}</div>
							<div class="supergraph-card-content">${escapedSnippet}</div>
						</div>
					`;
				},
			},
		]);
	}

	private escapeHtml(text: string): string {
		const div = document.createElement("div");
		div.textContent = text;
		return div.innerHTML;
	}

	private async loadGraphData(): Promise<void> {
		const files = this.app.vault.getMarkdownFiles();
		const nodes: GraphNode[] = [];
		const edges: GraphEdge[] = [];

		// Create nodes from files (async to load content snippets)
		const nodePromises: Promise<GraphNode>[] = [];
		for (const file of files) {
			if (this.shouldIncludeFile(file)) {
				nodePromises.push(this.createNodeFromFile(file));
			}
		}
		const loadedNodes = await Promise.all(nodePromises);
		nodes.push(...loadedNodes);

		// Create edges from links
		if (this.plugin.settings.showLinks) {
			for (const file of files) {
				const cache = this.app.metadataCache.getFileCache(file);
				if (cache?.links) {
					for (const link of cache.links) {
						const targetFile =
							this.app.metadataCache.getFirstLinkpathDest(
								link.link,
								file.path,
							);
						if (targetFile) {
							edges.push({
								id: `${file.path}->${targetFile.path}`,
								source: file.path,
								target: targetFile.path,
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
			nodes.forEach((node) => {
				const savedNode = savedState.nodes.find(
					(n) => n.id === node.id,
				);
				if (savedNode?.position) {
					node.position = savedNode.position;
				}
			});

			// Add manual edges
			savedState.edges.forEach((edge) => {
				if (edge.isManual && !edges.find((e) => e.id === edge.id)) {
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
		let snippet = "";
		try {
			// First, check for description in frontmatter
			const cache = this.app.metadataCache.getFileCache(file);
			const description = cache?.frontmatter?.description;

			if (description && typeof description === "string") {
				snippet = description.slice(0, this.display.snippetLength);
				if (description.length > this.display.snippetLength) {
					snippet += "...";
				}
			} else {
				// Fall back to content snippet
				const content = await this.app.vault.cachedRead(file);
				// Remove frontmatter if present
				let cleanContent = content;
				if (cleanContent.startsWith("---")) {
					const endIndex = cleanContent.indexOf("---", 3);
					if (endIndex !== -1) {
						cleanContent = cleanContent.slice(endIndex + 3).trim();
					}
				}
				// Remove headings, links, and formatting for cleaner preview
				cleanContent = cleanContent
					.replace(/^#+\s+/gm, "") // Remove headings
					.replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, "$1") // Convert [[link]] to text
					.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // Convert [text](url) to text
					.replace(/[*_~`]/g, "") // Remove formatting
					.replace(/\n+/g, " ") // Replace newlines with spaces
					.trim();
				snippet = cleanContent.slice(0, this.display.snippetLength);
				if (cleanContent.length > this.display.snippetLength) {
					snippet += "...";
				}
			}
		} catch (e) {
			// Ignore read errors, leave snippet empty
		}
		return {
			id: file.path,
			label: file.basename,
			snippet,
		};
	}

	private renderGraph(
		nodes: GraphNode[],
		edges: GraphEdge[],
		savedState: GraphState | null,
	): void {
		if (!this.cy) return;

		// Check if all nodes have saved positions
		const allNodesHavePositions =
			nodes.length > 0 && nodes.every((n) => n.position);

		// Get center of the viewport for initial positioning
		const containerWidth =
			this.graphContainer?.clientWidth || PHYSICS.DEFAULT_WIDTH;
		const containerHeight =
			this.graphContainer?.clientHeight || PHYSICS.DEFAULT_HEIGHT;
		const centerX = containerWidth / 2;
		const centerY = containerHeight / 2;

		const elements = [
			...nodes.map((node) => {
				// If we have saved position, use it. Otherwise start from center with slight random offset
				let position = node.position;
				if (!position) {
					// Small random offset from center for initial "explosion" effect
					position = {
						x:
							centerX +
							(Math.random() - 0.5) * PHYSICS.INITIAL_SPREAD,
						y:
							centerY +
							(Math.random() - 0.5) * PHYSICS.INITIAL_SPREAD,
					};
				}
				return {
					data: {
						id: node.id,
						label: node.label,
						snippet: node.snippet,
					},
					position,
				};
			}),
			...edges.map((edge) => ({
				data: {
					id: edge.id,
					source: edge.source,
					target: edge.target,
				},
				classes: edge.isManual ? "manual" : "",
			})),
		];

		this.cy.elements().remove();
		this.cy.add(elements);

		// Enable dragging on all nodes after they are added
		this.cy.nodes().forEach((node) => {
			node.grabify();
		});

		if (allNodesHavePositions && savedState?.zoom && savedState?.pan) {
			// Restore saved viewport
			this.cy.viewport({
				zoom: savedState.zoom,
				pan: savedState.pan,
			});
		} else {
			// Fit to show all nodes initially
			this.cy.fit(undefined, PHYSICS.FIT_PADDING);
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

		const centerX =
			(this.graphContainer?.clientWidth || PHYSICS.DEFAULT_WIDTH) / 2;
		const centerY =
			(this.graphContainer?.clientHeight || PHYSICS.DEFAULT_HEIGHT) / 2;

		// Calculate forces from user settings and physics constants
		const repelStrength =
			-this.forces.repelForce * PHYSICS.REPEL_MULTIPLIER;
		const linkDistance = Math.max(
			this.forces.linkDistance,
			PHYSICS.MIN_LINK_DISTANCE,
		);
		const linkStrength =
			this.forces.linkForce * PHYSICS.LINK_STRENGTH_MULTIPLIER;
		const centerStrength =
			this.forces.centerForce * PHYSICS.CENTER_MULTIPLIER;
		// Use the larger dimension for collision radius to prevent overlap
		const cardDiagonal = Math.sqrt(
			this.display.cardWidth ** 2 + this.display.cardHeight ** 2,
		);
		const collideRadius = cardDiagonal / 2;

		this.layout = this.cy.layout({
			name: "d3-force",
			animate: true,
			fixedAfterDragging: false,
			ungrabifyWhileSimulating: false,
			fit: false,
			// @ts-ignore - d3-force specific options
			alpha: PHYSICS.ALPHA_START,
			alphaMin: PHYSICS.ALPHA_MIN,
			alphaDecay: PHYSICS.ALPHA_DECAY,
			alphaTarget: PHYSICS.ALPHA_TARGET,
			velocityDecay: PHYSICS.VELOCITY_DECAY,
			// Collision force - prevents overlap
			collideRadius: collideRadius,
			collideStrength: PHYSICS.COLLIDE_STRENGTH,
			// Many-body force - repulsion between all nodes
			manyBodyStrength: repelStrength,
			manyBodyDistanceMin: PHYSICS.MANY_BODY_DISTANCE_MIN,
			manyBodyDistanceMax: PHYSICS.MANY_BODY_DISTANCE_MAX,
			// Link force - spring with minimum length
			linkId: function (d: any) {
				return d.id;
			},
			linkDistance: linkDistance,
			linkStrength: linkStrength,
			// Center force - pulls toward center
			xStrength: centerStrength,
			xX: centerX,
			yStrength: centerStrength,
			yY: centerY,
		} as cytoscape.LayoutOptions);

		this.layout.run();
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

		this.cy.nodes().forEach((node) => {
			const pos = node.position();
			nodes.push({
				id: node.id(),
				label: node.data("label"),
				snippet: node.data("snippet"),
				position: { x: pos.x, y: pos.y },
			});
		});

		this.cy.edges().forEach((edge) => {
			edges.push({
				id: edge.id(),
				source: edge.data("source"),
				target: edge.data("target"),
				isManual: edge.hasClass("manual"),
			});
		});

		const state: GraphState = {
			nodes,
			edges,
			zoom: this.cy.zoom(),
			pan: this.cy.pan(),
		};

		await this.plugin.saveData({ graphState: state });
	}

	private async loadGraphState(): Promise<GraphState | null> {
		const data = await this.plugin.loadData();
		return data?.graphState || null;
	}

	private async saveViewSettings(): Promise<void> {
		const data = (await this.plugin.loadData()) || {};
		data.viewSettings = {
			display: this.display,
			forces: this.forces,
		};
		await this.plugin.saveData(data);
	}

	private async loadViewSettings(): Promise<void> {
		const data = await this.plugin.loadData();
		if (data?.viewSettings) {
			this.display = { ...DEFAULT_DISPLAY, ...data.viewSettings.display };
			this.forces = { ...DEFAULT_FORCES, ...data.viewSettings.forces };
		}
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

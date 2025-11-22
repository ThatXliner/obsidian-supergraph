import { Plugin, WorkspaceLeaf, TFile } from 'obsidian';
import { SupergraphView, VIEW_TYPE_SUPERGRAPH } from './src/SupergraphView';
import { SupergraphSettings, DEFAULT_SETTINGS } from './src/settings';
import { SupergraphSettingTab } from './src/SupergraphSettingTab';

export default class SupergraphPlugin extends Plugin {
	settings: SupergraphSettings;

	async onload() {
		await this.loadSettings();

		// Register the custom view
		this.registerView(
			VIEW_TYPE_SUPERGRAPH,
			(leaf) => new SupergraphView(leaf, this)
		);

		// Add ribbon icon
		this.addRibbonIcon('git-fork', 'Open Supergraph', () => {
			this.activateView();
		});

		// Add command to open the view
		this.addCommand({
			id: 'open-supergraph',
			name: 'Open Supergraph',
			callback: () => {
				this.activateView();
			}
		});

		// Add settings tab
		this.addSettingTab(new SupergraphSettingTab(this.app, this));

		// Watch for file changes to update the graph
		this.registerEvent(
			this.app.vault.on('modify', (file) => {
				if (file instanceof TFile) {
					this.refreshAllViews();
				}
			})
		);

		this.registerEvent(
			this.app.vault.on('create', (file) => {
				if (file instanceof TFile) {
					this.refreshAllViews();
				}
			})
		);

		this.registerEvent(
			this.app.vault.on('delete', (file) => {
				if (file instanceof TFile) {
					this.refreshAllViews();
				}
			})
		);

		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				if (file instanceof TFile) {
					this.refreshAllViews();
				}
			})
		);
	}

	onunload() {
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_SUPERGRAPH);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async activateView() {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_SUPERGRAPH);

		if (leaves.length > 0) {
			// A leaf with our view already exists, use that
			leaf = leaves[0];
		} else {
			// Our view could not be found in the workspace, create a new leaf
			leaf = workspace.getRightLeaf(false);
			await leaf?.setViewState({
				type: VIEW_TYPE_SUPERGRAPH,
				active: true
			});
		}

		// Reveal the leaf in case it is in a collapsed sidebar
		if (leaf) {
			workspace.revealLeaf(leaf);
		}
	}

	refreshAllViews() {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_SUPERGRAPH);
		leaves.forEach(leaf => {
			const view = leaf.view;
			if (view instanceof SupergraphView) {
				view.refreshGraph();
			}
		});
	}
}

import { App, PluginSettingTab, Setting } from 'obsidian';
import SupergraphPlugin from '../main';

export class SupergraphSettingTab extends PluginSettingTab {
	plugin: SupergraphPlugin;

	constructor(app: App, plugin: SupergraphPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl('h2', { text: 'Supergraph Settings' });

		new Setting(containerEl)
			.setName('Show all files')
			.setDesc('Display all markdown files in the vault')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showAllFiles)
				.onChange(async (value) => {
					this.plugin.settings.showAllFiles = value;
					await this.plugin.saveSettings();
					this.plugin.refreshAllViews();
				}));

		new Setting(containerEl)
			.setName('Show links')
			.setDesc('Display links between notes as edges')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showLinks)
				.onChange(async (value) => {
					this.plugin.settings.showLinks = value;
					await this.plugin.saveSettings();
					this.plugin.refreshAllViews();
				}));

		new Setting(containerEl)
			.setName('Max snippet length')
			.setDesc('Maximum number of characters to show in the snippet preview')
			.addText(text => text
				.setPlaceholder('150')
				.setValue(String(this.plugin.settings.maxSnippetLength))
				.onChange(async (value) => {
					const num = parseInt(value);
					if (!isNaN(num) && num > 0) {
						this.plugin.settings.maxSnippetLength = num;
						await this.plugin.saveSettings();
						this.plugin.refreshAllViews();
					}
				}));

		new Setting(containerEl)
			.setName('Minimum zoom for cards')
			.setDesc('Zoom level at which to switch from dots to card view (0-2)')
			.addText(text => text
				.setPlaceholder('0.5')
				.setValue(String(this.plugin.settings.minZoomForCards))
				.onChange(async (value) => {
					const num = parseFloat(value);
					if (!isNaN(num) && num >= 0 && num <= 2) {
						this.plugin.settings.minZoomForCards = num;
						await this.plugin.saveSettings();
					}
				}));

		new Setting(containerEl)
			.setName('Enable manual edges')
			.setDesc('Allow creating manual connections between notes')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableManualEdges)
				.onChange(async (value) => {
					this.plugin.settings.enableManualEdges = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('File filter')
			.setDesc('Only show files matching this text (case-insensitive)')
			.addText(text => text
				.setPlaceholder('folder/path or keyword')
				.setValue(this.plugin.settings.fileFilter)
				.onChange(async (value) => {
					this.plugin.settings.fileFilter = value;
					await this.plugin.saveSettings();
					this.plugin.refreshAllViews();
				}));
	}
}

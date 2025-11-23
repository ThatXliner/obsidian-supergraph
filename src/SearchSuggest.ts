import {
	AbstractInputSuggest,
	App,
	TFile,
	setIcon,
} from "obsidian";

/**
 * Autocomplete suggestions for the Graph Search input.
 * Approximates Obsidian Graph View autocomplete behavior.
 */

export interface SuggestionItem {
	type: "tag" | "path" | "prefix" | "file";
	value: string; // The value to insert
	display: string; // Display text in dropdown
}

// Common prefixes to suggest at the start of input or after space
const PREFIX_SUGGESTIONS: SuggestionItem[] = [
	{ type: "prefix", value: "tag:", display: "tag:" },
	{ type: "prefix", value: "path:", display: "path:" },
	{ type: "prefix", value: "-", display: "- (exclude)" },
];

export class SearchSuggest extends AbstractInputSuggest<SuggestionItem> {
	private tags: Set<string> = new Set();
	private paths: Set<string> = new Set();
	private files: Map<string, string> = new Map(); // basename -> path
	private textInputEl: HTMLInputElement;

	constructor(app: App, inputEl: HTMLInputElement) {
		super(app, inputEl);
		this.textInputEl = inputEl;
		this.limit = 20;
		this.refreshSuggestionData();
	}

	/**
	 * Refresh cached tags, paths, and files from the vault.
	 * Call this when vault contents change.
	 */
	refreshSuggestionData(): void {
		this.tags.clear();
		this.paths.clear();
		this.files.clear();

		const markdownFiles = this.app.vault.getMarkdownFiles();

		for (const file of markdownFiles) {
			// Collect file basenames
			this.files.set(file.basename.toLowerCase(), file.path);

			// Collect unique folder paths
			const folder = file.parent?.path;
			if (folder && folder !== "/") {
				this.paths.add(folder);
			}

			// Collect tags from metadata
			const cache = this.app.metadataCache.getFileCache(file);

			// Inline tags
			if (cache?.tags) {
				for (const tagRef of cache.tags) {
					// Remove # prefix and store lowercase
					this.tags.add(tagRef.tag.slice(1).toLowerCase());
				}
			}

			// Frontmatter tags
			const fmTags = cache?.frontmatter?.tags;
			if (fmTags) {
				if (Array.isArray(fmTags)) {
					for (const t of fmTags) {
						if (typeof t === "string") {
							this.tags.add(t.replace(/^#/, "").toLowerCase());
						}
					}
				} else if (typeof fmTags === "string") {
					this.tags.add(fmTags.replace(/^#/, "").toLowerCase());
				}
			}
		}
	}

	/**
	 * Get the current token being typed (last space-separated term).
	 */
	private getCurrentToken(inputValue: string): {
		prefix: string;
		token: string;
		isNegated: boolean;
	} {
		const parts = inputValue.split(/\s+/);
		const lastPart = parts[parts.length - 1] || "";

		let token = lastPart;
		let isNegated = false;

		// Check for negation
		if (token.startsWith("-") && token.length > 1) {
			isNegated = true;
			token = token.slice(1);
		}

		// Everything before the current token
		const prefix =
			parts.length > 1 ? parts.slice(0, -1).join(" ") + " " : "";

		return { prefix, token, isNegated };
	}

	getSuggestions(inputValue: string): SuggestionItem[] {
		const { prefix, token, isNegated } = this.getCurrentToken(inputValue);
		const suggestions: SuggestionItem[] = [];
		const negationPrefix = isNegated ? "-" : "";

		// If at start of token or just typed "-", show prefix suggestions
		if (token === "" || (token === "-" && !isNegated)) {
			return PREFIX_SUGGESTIONS;
		}

		// Handle tag: prefix - suggest tag values only
		if (token.startsWith("tag:")) {
			const tagQuery = token.slice(4).toLowerCase();
			for (const tag of this.tags) {
				if (tag.includes(tagQuery)) {
					suggestions.push({
						type: "tag",
						value: tag, // Just the tag name, not "tag:xxx"
						display: `#${tag}`,
					});
				}
				if (suggestions.length >= this.limit) break;
			}
			return suggestions;
		}

		// Handle path: prefix - suggest path values only
		if (token.startsWith("path:")) {
			const pathQuery = token.slice(5).toLowerCase();
			for (const path of this.paths) {
				if (path.toLowerCase().includes(pathQuery)) {
					suggestions.push({
						type: "path",
						value: path, // Just the path, not "path:xxx"
						display: path,
					});
				}
				if (suggestions.length >= this.limit) break;
			}
			return suggestions;
		}

		// Plain text: suggest matching tags and files
		const query = token.toLowerCase();

		// Suggest prefix completions if query matches
		for (const prefixSug of PREFIX_SUGGESTIONS) {
			if (
				prefixSug.value.startsWith(query) &&
				prefixSug.value !== query
			) {
				suggestions.push({
					...prefixSug,
					value: negationPrefix + prefixSug.value,
				});
			}
		}

		// Suggest matching tags
		for (const tag of this.tags) {
			if (tag.includes(query)) {
				suggestions.push({
					type: "tag",
					value: `${negationPrefix}tag:${tag}`,
					display: `#${tag}`,
				});
			}
			if (suggestions.length >= this.limit) break;
		}

		// Suggest matching file names
		for (const [basename, path] of this.files) {
			if (basename.includes(query)) {
				suggestions.push({
					type: "file",
					value: `${negationPrefix}path:${path}`,
					display: basename,
				});
			}
			if (suggestions.length >= this.limit) break;
		}

		return suggestions.slice(0, this.limit);
	}

	renderSuggestion(item: SuggestionItem, el: HTMLElement): void {
		el.addClass("search-suggestion-item");

		// Icon based on type
		const iconEl = el.createSpan({ cls: "search-suggestion-icon" });
		switch (item.type) {
			case "tag":
				setIcon(iconEl, "hash");
				break;
			case "path":
			case "file":
				setIcon(iconEl, "folder");
				break;
			case "prefix":
				setIcon(iconEl, "search");
				break;
		}

		// Display text
		el.createSpan({ text: item.display, cls: "search-suggestion-text" });
	}

	selectSuggestion(
		item: SuggestionItem,
		_evt: MouseEvent | KeyboardEvent,
	): void {
		const inputValue = this.textInputEl.value;
		const { prefix, token, isNegated } = this.getCurrentToken(inputValue);
		const negationPrefix = isNegated ? "-" : "";

		let insertValue: string;
		let addTrailingSpace = true;

		// Reconstruct the full token based on context
		if (item.type === "prefix") {
			// Prefixes like "tag:", "path:", "-" should not have trailing space
			insertValue = `${negationPrefix}${item.value}`;
			addTrailingSpace = false;
		} else if (item.type === "tag") {
			insertValue = `${negationPrefix}tag:${item.value}`;
		} else if (item.type === "path") {
			insertValue = `${negationPrefix}path:${item.value}`;
		} else if (item.type === "file") {
			insertValue = `${negationPrefix}path:${item.value}`;
		} else {
			insertValue = `${negationPrefix}${item.value}`;
		}

		// Replace current token with selected suggestion
		const newValue = prefix + insertValue + (addTrailingSpace ? " " : "");
		this.textInputEl.value = newValue;
		this.setValue(newValue);

		// Trigger input event so the graph updates
		this.textInputEl.dispatchEvent(new Event("input", { bubbles: true }));
		this.close();
	}
}

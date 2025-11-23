import { App, TFile, CachedMetadata } from "obsidian";

/**
 * Graph Search Module
 *
 * Approximates Obsidian's Graph View search/filter behavior:
 * - Match against file path, aliases, and tags
 * - Case-insensitive partial (substring) matching
 * - Support for tag:, path:, and negation (-) prefixes
 * - Space-separated terms use AND logic
 */

export type SearchTermType = "text" | "tag" | "path";

export interface SearchTerm {
	type: SearchTermType;
	value: string;
	negated: boolean;
}

/**
 * Parse a search query string into structured terms.
 *
 * Grammar:
 *   - Space-separated tokens are AND'd together
 *   - `tag:xxx` or `tag:"xxx"` filters by tag (matches #xxx)
 *   - `path:xxx` or `path:"xxx"` filters by file path
 *   - `-xxx` excludes items matching "xxx"
 *   - `-tag:xxx` excludes items with tag #xxx
 *   - `-path:xxx` excludes items in path xxx
 *   - Plain text matches against path + aliases
 *   - Quoted values preserve spaces: path:"my folder/sub"
 *
 * @example
 * parseQuery('foo tag:"my project" -path:"archive"')
 * // Returns:
 * // [
 * //   { type: "text", value: "foo", negated: false },
 * //   { type: "tag", value: "my project", negated: false },
 * //   { type: "path", value: "archive", negated: true }
 * // ]
 */
export function parseQuery(query: string): SearchTerm[] {
	const terms: SearchTerm[] = [];

	// Tokenize while respecting quoted strings
	// Matches: -tag:"value" | tag:"value" | -"value" | "value" | word
	const tokenRegex = /(-)?(?:(tag|path):)?(?:"([^"]*)"|(\S+))/g;
	let match;

	while ((match = tokenRegex.exec(query)) !== null) {
		const negated = match[1] === "-";
		const prefix = match[2]; // "tag" or "path" or undefined
		const quotedValue = match[3]; // value inside quotes
		const unquotedValue = match[4]; // value without quotes

		let value = (quotedValue !== undefined ? quotedValue : unquotedValue) || "";
		value = value.toLowerCase();

		if (!value && !prefix) continue;

		if (prefix === "tag") {
			if (value) {
				terms.push({ type: "tag", value, negated });
			}
		} else if (prefix === "path") {
			if (value) {
				terms.push({ type: "path", value, negated });
			}
		} else if (value) {
			terms.push({ type: "text", value, negated });
		}
	}

	return terms;
}

/**
 * Extract all tags from a file's metadata cache.
 * Combines inline tags (#tag) and frontmatter tags.
 * Returns lowercase tag names without the # prefix.
 */
function extractTags(cache: CachedMetadata | null): string[] {
	const tags: string[] = [];

	// Inline tags from content (e.g., #project)
	if (cache?.tags) {
		for (const tagRef of cache.tags) {
			// tagRef.tag includes the # prefix, e.g., "#project"
			tags.push(tagRef.tag.slice(1).toLowerCase());
		}
	}

	// Frontmatter tags (can be string or array)
	const fmTags = cache?.frontmatter?.tags;
	if (fmTags) {
		if (Array.isArray(fmTags)) {
			for (const t of fmTags) {
				if (typeof t === "string") {
					// Remove # if present
					tags.push(t.replace(/^#/, "").toLowerCase());
				}
			}
		} else if (typeof fmTags === "string") {
			tags.push(fmTags.replace(/^#/, "").toLowerCase());
		}
	}

	return tags;
}

/**
 * Extract aliases from a file's frontmatter.
 * Returns lowercase alias strings.
 */
function extractAliases(cache: CachedMetadata | null): string[] {
	const aliases: string[] = [];
	const fmAliases = cache?.frontmatter?.aliases;

	if (fmAliases) {
		if (Array.isArray(fmAliases)) {
			for (const a of fmAliases) {
				if (typeof a === "string") {
					aliases.push(a.toLowerCase());
				}
			}
		} else if (typeof fmAliases === "string") {
			aliases.push(fmAliases.toLowerCase());
		}
	}

	return aliases;
}

/**
 * Check if a single search term matches the file.
 */
function termMatches(
	term: SearchTerm,
	filePath: string,
	aliases: string[],
	tags: string[],
): boolean {
	const value = term.value;

	switch (term.type) {
		case "tag":
			// Match if any tag contains the search value (substring match)
			return tags.some((tag) => tag.includes(value));

		case "path":
			// Match against file path only
			return filePath.includes(value);

		case "text":
			// Match against file path OR any alias
			// Approximates Graph View behavior: searches filename/path and aliases
			if (filePath.includes(value)) {
				return true;
			}
			if (aliases.some((alias) => alias.includes(value))) {
				return true;
			}
			return false;

		default:
			return false;
	}
}

/**
 * Check if a file matches all search terms.
 *
 * Logic:
 *   - All non-negated terms must match (AND)
 *   - If ANY negated term matches, the file is excluded
 *   - Empty query matches all files
 *
 * @param file - The file to check
 * @param terms - Parsed search terms from parseQuery()
 * @param app - Obsidian App instance for accessing metadataCache
 */
export function matchesQuery(
	file: TFile,
	terms: SearchTerm[],
	app: App,
): boolean {
	// Empty query matches everything
	if (terms.length === 0) {
		return true;
	}

	const cache = app.metadataCache.getFileCache(file);
	const filePath = file.path.toLowerCase();
	const aliases = extractAliases(cache);
	const tags = extractTags(cache);

	for (const term of terms) {
		const matches = termMatches(term, filePath, aliases, tags);

		if (term.negated) {
			// Negated term: if it matches, exclude the file
			if (matches) {
				return false;
			}
		} else {
			// Positive term: must match
			if (!matches) {
				return false;
			}
		}
	}

	return true;
}

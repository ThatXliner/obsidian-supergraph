# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Commands

```bash
npm install          # Install dependencies
npm run dev          # Watch mode - auto-rebuilds on changes
npm run build        # Production build (type-checks first)
```

The build uses esbuild configured in `esbuild.config.mjs`. Output is `main.js` in the root directory.

## Architecture

This is an Obsidian plugin that provides an interactive graph view where notes are displayed as draggable cards with title and snippet previews.

### Key Files

- `main.ts` - Plugin entry point, registers the view, handles vault file events (create/modify/delete/rename)
- `src/SupergraphView.ts` - Core graph visualization using Cytoscape.js with d3-force layout
- `src/settings.ts` - Plugin settings interface and defaults
- `src/SupergraphSettingTab.ts` - Obsidian settings tab UI
- `src/types.ts` - TypeScript interfaces for graph data structures

### Graph Rendering

The graph uses Cytoscape.js with these extensions:
- `cytoscape-d3-force` - Physics-based force layout for node positioning
- `cytoscape-node-html-label` - Renders HTML card nodes instead of default circles

Force physics constants are defined in `PHYSICS` object at top of `SupergraphView.ts`. User-configurable settings (display and forces) are separate from physics constants.

### Data Flow

1. `SupergraphPlugin` watches vault events and triggers `refreshAllViews()` (debounced)
2. `SupergraphView.loadGraphData()` reads markdown files, creates nodes with snippets
3. Node snippets prefer frontmatter `description` field, falling back to cleaned content
4. Graph state (positions, zoom, pan) persists via `plugin.saveData()`/`plugin.loadData()`

### Styling

CSS is in `styles.css`. Uses Obsidian CSS variables for theme compatibility (e.g., `--background-primary`, `--interactive-accent`).

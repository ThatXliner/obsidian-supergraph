# Obsidian Supergraph

An enhanced graph view plugin for Obsidian that transforms all your notes into an interactive, zoomable network of card-nodes showing titles and snippet previews.

## Features

- **Interactive Card-Based Graph**: View all your notes as cards in a zoomable graph
- **Smart Zoom Levels**: Seamlessly switch between minimal dots (zoomed out) and full cards with snippets (zoomed in)
- **Title + Snippet Previews**: See note titles and preview the first few lines of content directly on the graph
- **Draggable & Persistent**: Drag nodes to organize your graph - positions are automatically saved
- **Click to Open**: Click any node to open the corresponding note
- **Auto-Update**: Graph automatically updates when you create, modify, or delete files
- **Link Visualization**: Displays connections between notes based on internal links
- **Flexible Filtering**: Filter which notes appear in the graph
- **Manual Edge Creation**: Support for creating custom connections (coming soon)
- **No Special Format Required**: Works with all your existing markdown files

## Installation

### From GitHub Releases

1. Download the latest release from the [Releases](https://github.com/ThatXliner/obsidian-supergraph/releases) page
2. Extract the files to your vault's `.obsidian/plugins/obsidian-supergraph/` directory
3. Reload Obsidian
4. Enable the plugin in Settings → Community Plugins

### Manual Installation

1. Clone this repository or download the source
2. Run `npm install` to install dependencies
3. Run `npm run build` to build the plugin
4. Copy `main.js`, `manifest.json`, and `styles.css` to your vault's `.obsidian/plugins/obsidian-supergraph/` directory
5. Reload Obsidian
6. Enable the plugin in Settings → Community Plugins

## Usage

### Opening the Graph

- Click the graph icon in the left ribbon
- Use the command palette (Cmd/Ctrl+P) and search for "Open Supergraph"

### Navigation

- **Zoom**: Use mouse wheel or trackpad to zoom in/out
- **Pan**: Click and drag on empty space to move the graph
- **Move Nodes**: Click and drag nodes to reposition them
- **Open Note**: Click on any node to open that note

### Settings

Access plugin settings via Settings → Supergraph:

- **Show all files**: Toggle to show/hide all markdown files
- **Show links**: Display connections between linked notes
- **Max snippet length**: Control how much preview text to show
- **Minimum zoom for cards**: Set the zoom level where nodes switch from dots to cards
- **Enable manual edges**: Allow creating custom connections
- **File filter**: Filter nodes by path or keyword

## Development

### Building

```bash
npm install
npm run build
```

### Watch Mode

```bash
npm run dev
```

## Technical Details

- Built with TypeScript
- Uses [Cytoscape.js](https://js.cytoscape.org/) for graph visualization
- Saves graph state (positions, zoom, pan) in JSON format
- Fully integrated with Obsidian's vault API

## License

MIT

## Support

If you encounter any issues or have feature requests, please [open an issue](https://github.com/ThatXliner/obsidian-supergraph/issues) on GitHub.


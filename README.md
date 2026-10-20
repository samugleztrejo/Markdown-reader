# RRSS Docs — Local Markdown Reader

RRSS Docs is a lightweight Markdown document reader that runs directly in your browser. Select a folder on your computer, browse all its `.md` files, and read them through a clean, comfortable interface.

It is designed for sharing project documentation with people who do not need to know Git, use a terminal, or install additional software.

## What it is for

- Read all Markdown documents in a project from a single interface.
- Preserve the original folder and file structure while browsing.
- Consult local documentation without uploading it to the Internet.
- Navigate between related documents using relative links.
- Enjoy a clearer reading experience than a standard text editor provides.

## Features

- Expandable folder tree in the sidebar.
- Document filtering by name or path.
- GitHub Flavored Markdown rendering.
- Support for tables, lists, checklists, blockquotes, and code blocks.
- Copy button for code blocks.
- Search within the active document.
- Automatic table of contents generated from headings.
- Relative links between loaded documents.
- Recovery of the project and active document when the same tab is reloaded.
- Local image display when the browser can resolve the resource.
- Light and dark themes.
- Collapsible sidebar and table of contents.
- Responsive design for smaller screens.
- Sanitization of generated HTML before it is displayed.

## How to use it

1. Download or clone this repository.
2. Open `index.html` with Google Chrome or Microsoft Edge.
3. Click **Open project**.
4. Select the folder containing the Markdown documents you want to read.
5. Choose any document from the sidebar to open it.

After a project has been loaded, you can select a different folder using **Change folder** at the bottom of the sidebar.

If the main folder picker is unavailable in your browser, use **Use compatible picker**.

## Compatibility

A recent version of either of these browsers is recommended:

- Google Chrome.
- Microsoft Edge.

The application uses the File System Access API when it is available. It also includes a `webkitdirectory` fallback for browsers that do not allow that API to be used from local files.

The browser asks for permission before accessing a folder. When the same tab is reloaded, RRSS Docs attempts to restore the project automatically and reads the files from disk again so recent changes are displayed. If the browser needs to renew access, a **Reopen project** option is shown.

Automatic recovery ends when the tab is closed. Due to browser security restrictions, folders selected through the compatible picker cannot be retained after a reload.

## Privacy and security

- All processing happens locally in the browser.
- Selected documents are never uploaded to a server.
- The application does not modify or save changes to Markdown files.
- No backend, database, user account, or Internet connection is required.
- Markdown-generated HTML is sanitized before it is displayed.
- `.git`, `node_modules`, and `app` folders are ignored while browsing.

## Offline support

All required dependencies are included in the `vendor/` folder, so the reader works without an Internet connection:

- [Marked](https://marked.js.org/) renders Markdown with GFM support.
- [DOMPurify](https://github.com/cure53/DOMPurify) sanitizes the generated HTML.

## Project structure

```text
Markdown-reader/
├── index.html           # Main page
├── styles.css           # Layout and themes
├── app.js               # Folder access and application behavior
├── vendor/
│   ├── marked.min.js    # Local Markdown renderer
│   └── purify.min.js    # Local HTML sanitizer
└── README.md
```

## Limitations

- Folder access depends on browser capabilities and permissions.
- Some images or external resources may not be available while offline.
- The application is read-only and cannot edit or save documents.
- Visual preferences can be remembered, but the folder is only restored during the current tab session.

## Technology

The project uses only HTML5, CSS3, and vanilla JavaScript. It requires no build process, dependency installation, or local server.

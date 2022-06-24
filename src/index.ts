import joplin from "api";
import { SettingItemType, ToolbarButtonLocation } from "api/types";

const uslug = require("uslug");
const katex = require("katex");
const _ = require("lodash");

var expandLevel;
var headers = {};
var expandState = {};

joplin.plugins.register({
	onStart: async function() {
		// settings
		await joplin.settings.registerSettings({
			showToc: {
				label: "Show Table of Contents",
				public: false,
				type: SettingItemType.Bool,
				value: true
			},
			tocDefaultLevel: {
				label: "Default level to expand the table of contents to",
				public: true,
				type: SettingItemType.Int,
				value: 2,
				minimum: 1,
				maximum: 5
			}
		});

		var showToc = await joplin.settings.value("showToc");
		expandLevel = await joplin.settings.value("tocDefaultLevel");

		await joplin.settings.onChange(async (event) => {
			if (event.keys.includes("tocDefaultLevel")) {
				expandLevel = await joplin.settings.value("tocDefaultLevel");
				updateTocView(true);
			}
		});

		// panel
		const panel = await joplin.views.panels.create("toc");

		await joplin.views.panels.show(panel, showToc);
		await joplin.views.panels.addScript(panel, "./webview.css");
		await joplin.views.panels.onMessage(panel, (msg) => {
			if (msg.name == "scrollToHash") {
				joplin.commands.execute("scrollToHash", msg.slug);
			} else if (msg.name == "expandHeader") {
				expandState[msg.slug] =  msg.expanded;
			}
		});

		// toolbar
		await joplin.commands.register({
			name: "displayToc",
			label: "Change TOC visibility",
			iconName: "fas fa-list-alt",
			execute: async () => {
				await joplin.views.panels.show(panel, showToc = !showToc);
				joplin.settings.setValue("showToc", showToc);
			}
		});
		await joplin.views.toolbarButtons.create("displayToc", "displayToc", ToolbarButtonLocation.NoteToolbar);

		// generate TOC
		async function updateTocView(forceUpdate: boolean = false, restoreExpandState: boolean = false) {
			const note = await joplin.workspace.selectedNote();

			if (note) {
				const newHeaders = noteHeaders(note.body);

				if (!_.isEqual(headers, newHeaders) || forceUpdate) {
					headers = newHeaders;

					if (!restoreExpandState)
						expandState = {};

					await joplin.views.panels.setHtml(panel, `<div class="container">${buildTocHtml(headers, "", restoreExpandState)}</div>`);
				}
			}
		}

		await joplin.workspace.onNoteSelectionChange(() => {
			updateTocView();
		});

		await joplin.workspace.onNoteChange((e) => {
			updateTocView(false, true);
		});
	}
});

function noteHeaders(noteBody: string) {
	const headers = [];
	const lines = noteBody.split("\n");
	let slugCounts = {}

	for (const line of lines) {
		const match = line.match(/^(#+)\s(.*)*/);

		let level;
		let text;
		if (!match || (level = match[1].length - 1) == 0 || !(text = match[2]))
			continue;

		let slug = uslug(removeLaTeXMath(text));
		slugCounts[slug] = slugCounts[slug] ? slugCounts[slug] + 1 : 1;
		if (slugCounts[slug] > 1)
			slug += "-" + slugCounts[slug];

		let currentLevel = headers;

		for (let i = 1; i < level; i++) {
			if (currentLevel.length == 0)
				return false;

			currentLevel = currentLevel[currentLevel.length - 1].headers;
		}

		currentLevel.push({
			text: text,
			level: level,
			slug: slug,
			headers: []
		});
	}

	return headers;
}

function buildTocHtml(headers, prefix: string = "", restoreExpandState: boolean = false) {
	let html = ""

	let counter = 1;
	for (const header of headers) {
		const slug = escapeHtml(header.slug);

		const link = `
			<a class="toc" href="#" onClick="webviewApi.postMessage({name: 'scrollToHash', slug: '${slug}'})">
				${prefix}${counter} &nbsp;${escapeHtml(header.text)}
			</a>`;

		if (header.headers.length > 0) {
			const open = (restoreExpandState && expandState[slug]) || (!(slug in expandState) && header.level < expandLevel);

			html += `
				<details id="${slug}" class="toc" onToggle="webviewApi.postMessage({name: 'expandHeader', slug: '${slug}', expanded: this.open})" ${open ? "open" : ""}>
					<summary class="toc">
						${link}
					</summary>
					<div class="toc-nesting">
						${buildTocHtml(header.headers, prefix + counter + ".", restoreExpandState)}
					</div>
				</details>`;
		} else {
			html += `
				<div class="toc">
					${link}
				</div>
				<br>`;
		}

		counter++;
	}

	return html
}

function escapeHtml(unsafe: string) {
	return unsafe
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;")
		.replace(/\$([^\$]*)\$/g, (match, p1, ...args) => convertKatex(p1));
}

function convertKatex(s: string) {
	return katex.renderToString(s, { throwOnError: false, output: "html" });
}

function removeLaTeXMath(unsafe: string) {
	return unsafe.replace(/\$[^\$]*\$/g, "")
}

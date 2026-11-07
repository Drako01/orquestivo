/** Control Center stylesheet. Uses VS Code theme variables only, so light, dark and high-contrast all work. */
export const STYLES = `
:root{color-scheme:light dark}
*{box-sizing:border-box}
body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground);background:var(--vscode-editor-background);margin:0;padding:24px;line-height:1.5}
main{max-width:1000px;margin:0 auto}
h1{font-size:1.9em;margin:2px 0 0;letter-spacing:-.02em}
h2{font-size:1.25em;margin:28px 0 12px}
h3{font-size:1.05em;margin:0}
h4{font-size:1em;margin:16px 0 8px}
p{margin:4px 0}
code,pre{font-family:var(--vscode-editor-font-family);font-size:.92em}
pre{background:var(--vscode-textCodeBlock-background);padding:10px;border-radius:6px;overflow:auto;margin:6px 0;white-space:pre-wrap;word-break:break-word}
a{color:var(--vscode-textLink-foreground)}
a:hover{color:var(--vscode-textLink-activeForeground)}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.muted{color:var(--vscode-descriptionForeground)}
.head{display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:16px}
.brand{width:56px;height:56px;border-radius:14px;background:#14181d;object-fit:cover}
.eyebrow{color:var(--vscode-descriptionForeground);font-size:.78em;letter-spacing:.16em;text-transform:uppercase}
.toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:12px 0}
.toolbar label{color:var(--vscode-descriptionForeground)}
button,select{font:inherit;color:var(--vscode-button-secondaryForeground);background:var(--vscode-button-secondaryBackground);border:1px solid var(--vscode-contrastBorder,transparent);border-radius:4px;padding:5px 12px;cursor:pointer}
button:hover{background:var(--vscode-button-secondaryHoverBackground)}
button.primary{color:var(--vscode-button-foreground);background:var(--vscode-button-background)}
button.primary:hover{background:var(--vscode-button-hoverBackground)}
select{background:var(--vscode-dropdown-background);color:var(--vscode-dropdown-foreground);border-color:var(--vscode-dropdown-border,var(--vscode-panel-border))}
button[aria-pressed="true"]{outline:2px solid var(--vscode-focusBorder);outline-offset:-2px;font-weight:600}
button[aria-pressed="true"]::before{content:"✓ "}
button:focus-visible,select:focus-visible,a:focus-visible,summary:focus-visible,.node:focus-visible,[tabindex]:focus-visible{outline:2px solid var(--vscode-focusBorder);outline-offset:2px}
.banner{border-left:4px solid var(--vscode-textLink-foreground);background:var(--vscode-textBlockQuote-background);padding:8px 12px;border-radius:4px;margin:10px 0}
.banner.warn{border-left-color:var(--vscode-editorWarning-foreground)}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin:16px 0}
.card{background:var(--vscode-sideBar-background);border:1px solid var(--vscode-panel-border);border-radius:10px;padding:14px}
.card .value{font-size:1.8em;font-weight:700;font-variant-numeric:tabular-nums}
.card .caption{color:var(--vscode-descriptionForeground);font-size:.88em}
fieldset{border:1px solid var(--vscode-panel-border);border-radius:8px;margin:0 0 12px;padding:8px 12px}
legend{padding:0 6px;color:var(--vscode-descriptionForeground)}
.chips{display:flex;gap:8px;flex-wrap:wrap}
.panel{border:1px solid var(--vscode-panel-border);border-radius:10px;padding:16px;background:var(--vscode-sideBar-background);margin-bottom:16px}
.file-head{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:8px}
.badge{display:inline-block;border:1px solid var(--vscode-panel-border);border-radius:999px;padding:0 10px;font-size:.85em;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground)}
.chip{display:inline-block;border:1px solid var(--vscode-panel-border);border-radius:4px;padding:0 6px;font-size:.85em}
ul.list{list-style:none;margin:0;padding:0}
.finding{border-top:1px solid var(--vscode-panel-border);padding:12px 0}
.finding:first-child{border-top:0}
.finding-head{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}
.sev{font-weight:700;white-space:nowrap}
.sev-error .sev{color:var(--vscode-editorError-foreground)}
.sev-warning .sev{color:var(--vscode-editorWarning-foreground)}
.sev-information .sev{color:var(--vscode-editorInfo-foreground)}
.finding dl{margin:6px 0;display:grid;grid-template-columns:max-content 1fr;gap:2px 12px}
.finding dt{color:var(--vscode-descriptionForeground)}
.finding dd{margin:0}
details{margin:6px 0}
summary{cursor:pointer}
.graph-wrap{overflow-x:auto;border:1px solid var(--vscode-panel-border);border-radius:8px;padding:6px;background:var(--vscode-editor-background)}
.graph{max-width:100%;height:auto}
.graph .edge{fill:none;stroke:var(--vscode-descriptionForeground);stroke-width:1.5}
.graph .arrow{fill:var(--vscode-descriptionForeground)}
.node{cursor:pointer}
.node rect{fill:var(--vscode-sideBar-background);stroke:var(--vscode-foreground);stroke-width:1.5}
.node.cyclic rect{stroke-dasharray:5 3;stroke:var(--vscode-editorError-foreground);stroke-width:2}
.node:hover rect,.node:focus rect{stroke:var(--vscode-focusBorder);stroke-width:2.5}
.node text{fill:var(--vscode-foreground);font-family:var(--vscode-font-family)}
.node-name{font-size:13px;font-weight:600}
.node-sub,.node-line{font-size:11px;fill:var(--vscode-descriptionForeground)}
table{border-collapse:collapse;width:100%}
th,td{text-align:left;padding:6px 8px;border-top:1px solid var(--vscode-panel-border);vertical-align:top}
th{color:var(--vscode-descriptionForeground);font-weight:600}
.verdict{font-weight:700;white-space:nowrap}
.v-PASS{color:var(--vscode-testing-iconPassed,var(--vscode-foreground))}
.v-FAIL{color:var(--vscode-editorError-foreground)}
.v-WARN{color:var(--vscode-editorWarning-foreground)}
.v-BLOCKED{color:var(--vscode-editorError-foreground);text-decoration:underline}
.v-SKIP,.v-INCONCLUSIVE{color:var(--vscode-descriptionForeground);font-style:italic}
.basis{white-space:nowrap}
.empty{padding:12px 0;color:var(--vscode-descriptionForeground)}
footer{margin:24px 0;color:var(--vscode-descriptionForeground);font-size:.88em}
@media (max-width:620px){body{padding:14px}.finding dl{grid-template-columns:1fr}th,td{padding:4px}}
@media (forced-colors:active){.node rect{stroke:CanvasText}.card,.panel{border-color:CanvasText}}
`;

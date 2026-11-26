/**
 * Safe DOM-only Markdown renderer with native MathML LaTeX support.
 * Constructs DOM nodes strictly via document.createElement and textContent.
 * Never uses innerHTML, outerHTML, insertAdjacentHTML, or document.write.
 */

import { renderMath } from "./math.js";

function isSafeUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl, window.location.origin);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function appendInline(parent, text) {
  // Tokenize inline code, inline LaTeX ($...$ / \(...\)), links, bold, italic, and strikethrough safely.
  const pattern =
    /(`[^`]+`)|(\$\$[^$\n]+\$\$)|(\\\((.+?)\\\))|((?<!\\)\$(?!\s)([^$\n]+?)(?<!\s)\$)|(\[([^\]]+)\]\(([^)\s]+)\))|(\*\*([^*]+)\*\*)|(__([^_]+)__)|(\*([^*]+)\*)|(_([^_]+)_)|(~~([^~]+)~~)/g;

  let lastIndex = 0;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parent.appendChild(document.createTextNode(text.slice(lastIndex, match.index).replace(/\\\$/g, "$")));
    }

    if (match[1]) {
      const code = document.createElement("code");
      code.textContent = match[1].slice(1, -1);
      parent.appendChild(code);
    } else if (match[2]) {
      parent.appendChild(renderMath(match[2].slice(2, -2).trim(), false));
    } else if (match[3]) {
      parent.appendChild(renderMath(match[4].trim(), false));
    } else if (match[5]) {
      parent.appendChild(renderMath(match[6].trim(), false));
    } else if (match[7]) {
      const label = match[8];
      const href = match[9];
      if (isSafeUrl(href)) {
        const a = document.createElement("a");
        a.setAttribute("href", href);
        a.setAttribute("target", "_blank");
        a.setAttribute("rel", "noopener noreferrer");
        a.textContent = label;
        parent.appendChild(a);
      } else {
        parent.appendChild(document.createTextNode(label));
      }
    } else if (match[10] || match[12]) {
      const strong = document.createElement("strong");
      appendInline(strong, match[11] || match[13]);
      parent.appendChild(strong);
    } else if (match[14] || match[16]) {
      const em = document.createElement("em");
      appendInline(em, match[15] || match[17]);
      parent.appendChild(em);
    } else if (match[18]) {
      const del = document.createElement("del");
      appendInline(del, match[19]);
      parent.appendChild(del);
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    parent.appendChild(document.createTextNode(text.slice(lastIndex).replace(/\\\$/g, "$")));
  }
}

function createCodeBlock(codeText, language, blockIndex, onEditCodeBlock) {
  const wrap = document.createElement("div");
  wrap.className = "md-code-block";

  const header = document.createElement("div");
  header.className = "md-code-header";

  const langSpan = document.createElement("span");
  langSpan.textContent = language || "code";
  header.appendChild(langSpan);

  const actions = document.createElement("div");
  actions.className = "md-code-actions";

  let currentCode = codeText;
  const pre = document.createElement("pre");
  const code = document.createElement("code");
  code.textContent = currentCode;
  pre.appendChild(code);

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "md-copy-btn";
  copyBtn.textContent = "Copy";
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(currentCode);
      copyBtn.textContent = "Copied!";
      setTimeout(() => {
        copyBtn.textContent = "Copy";
      }, 1500);
    } catch {
      copyBtn.textContent = "Copy failed";
    }
  });

  if (typeof onEditCodeBlock === "function") {
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "md-copy-btn";
    editBtn.textContent = "Edit";

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "md-copy-btn md-save-btn hidden";
    saveBtn.textContent = "Save";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "md-copy-btn hidden";
    cancelBtn.textContent = "Cancel";

    let editorEl = null;

    const exitEditMode = () => {
      if (editorEl) {
        editorEl.remove();
        editorEl = null;
      }
      pre.classList.remove("hidden");
      editBtn.classList.remove("hidden");
      saveBtn.classList.add("hidden");
      cancelBtn.classList.add("hidden");
      saveBtn.disabled = false;
      saveBtn.textContent = "Save";
    };

    editBtn.addEventListener("click", () => {
      editorEl = document.createElement("textarea");
      editorEl.className = "md-code-editor";
      editorEl.value = currentCode;
      editorEl.setAttribute("spellcheck", "false");
      editorEl.setAttribute("autocapitalize", "off");
      editorEl.setAttribute("autocorrect", "off");
      editorEl.setAttribute("aria-label", `Edit ${language || "code"} snippet`);
      const lineCount = Math.min(40, Math.max(8, currentCode.split("\n").length + 2));
      editorEl.rows = lineCount;
      editorEl.addEventListener("keydown", (ev) => {
        if (ev.key === "Tab") {
          ev.preventDefault();
          const start = editorEl.selectionStart;
          const end = editorEl.selectionEnd;
          editorEl.value = editorEl.value.slice(0, start) + "  " + editorEl.value.slice(end);
          editorEl.selectionStart = editorEl.selectionEnd = start + 2;
        }
      });

      pre.classList.add("hidden");
      wrap.appendChild(editorEl);
      editBtn.classList.add("hidden");
      saveBtn.classList.remove("hidden");
      cancelBtn.classList.remove("hidden");
      editorEl.focus();
    });

    cancelBtn.addEventListener("click", exitEditMode);

    saveBtn.addEventListener("click", async () => {
      if (!editorEl) return;
      const updated = editorEl.value;
      saveBtn.disabled = true;
      saveBtn.textContent = "Saving...";
      try {
        const ok = await onEditCodeBlock(blockIndex, updated);
        if (ok !== false) {
          currentCode = updated;
          code.textContent = currentCode;
          exitEditMode();
          editBtn.textContent = "Saved ✓";
          setTimeout(() => {
            editBtn.textContent = "Edit";
          }, 1500);
        } else {
          saveBtn.disabled = false;
          saveBtn.textContent = "Save";
        }
      } catch {
        saveBtn.disabled = false;
        saveBtn.textContent = "Retry Save";
      }
    });

    actions.appendChild(editBtn);
    actions.appendChild(saveBtn);
    actions.appendChild(cancelBtn);
  }

  actions.appendChild(copyBtn);
  header.appendChild(actions);

  wrap.appendChild(header);
  wrap.appendChild(pre);
  return wrap;
}

/**
 * Replace the N-th fenced code block's contents inside a Markdown string,
 * preserving its original opening/closing fence markers and indentation.
 * @param {string} markdown
 * @param {number} targetIndex
 * @param {string} newCode
 * @returns {string}
 */
export function replaceCodeBlockInMarkdown(markdown, targetIndex, newCode) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let i = 0;
  let blockIdx = 0;

  while (i < lines.length) {
    const line = lines[i];
    const fenceMatch = line.match(/^(\s*)(`{3,}|~{3,})([\w#+.-]*)\s*$/);
    if (fenceMatch) {
      const indentStr = fenceMatch[1];
      const fenceChar = fenceMatch[2][0];
      const fenceLen = fenceMatch[2].length;
      const closeRe = new RegExp(`^\\s*${fenceChar}{${fenceLen},}\\s*$`);
      out.push(line);
      i += 1;
      const origCodeLines = [];
      while (i < lines.length && !closeRe.test(lines[i])) {
        origCodeLines.push(lines[i]);
        i += 1;
      }
      if (blockIdx === targetIndex) {
        const replacementLines = newCode.replace(/\r\n/g, "\n").split("\n");
        for (const rl of replacementLines) {
          out.push(indentStr && rl ? indentStr + rl : rl);
        }
      } else {
        out.push(...origCodeLines);
      }
      if (i < lines.length) {
        out.push(lines[i]);
        i += 1;
      }
      blockIdx += 1;
      continue;
    }
    out.push(line);
    i += 1;
  }

  return out.join("\n");
}

function parseTableRow(line) {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function isTableSeparator(line) {
  return /^\s*\|?(\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/.test(line);
}

/**
 * Render markdown string into a DOM container element.
 * @param {string} markdown
 * @param {string} [defaultCodeLang]
 * @param {{ onEditCodeBlock?: (index: number, newCode: string) => Promise<boolean> }} [options]
 * @returns {HTMLElement}
 */
export function renderMarkdown(markdown, defaultCodeLang = "", options = {}) {
  const root = document.createElement("div");
  root.className = "md-body";
  if (!markdown || !markdown.trim()) {
    return root;
  }

  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  let codeBlockIndex = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Blank line
    if (!line.trim()) {
      i += 1;
      continue;
    }

    // Fenced code block (supports ``` or ~~~ with optional indentation)
    const fenceMatch = line.match(/^(\s*)(`{3,}|~{3,})([\w#+.-]*)\s*$/);
    if (fenceMatch) {
      const fenceIndent = fenceMatch[1].length;
      const fenceChar = fenceMatch[2][0];
      const fenceLen = fenceMatch[2].length;
      const lang = fenceMatch[3] || defaultCodeLang || "";
      const closeRe = new RegExp(`^\\s*${fenceChar}{${fenceLen},}\\s*$`);
      const codeLines = [];
      i += 1;
      while (i < lines.length && !closeRe.test(lines[i])) {
        const rawLine = lines[i];
        codeLines.push(
          fenceIndent > 0 && rawLine.startsWith(" ".repeat(fenceIndent))
            ? rawLine.slice(fenceIndent)
            : rawLine
        );
        i += 1;
      }
      if (i < lines.length) i += 1; // skip closing fence
      root.appendChild(
        createCodeBlock(codeLines.join("\n"), lang, codeBlockIndex, options.onEditCodeBlock)
      );
      codeBlockIndex += 1;
      continue;
    }

    // Display math block: $$ ... $$ (single-line or multi-line) or \[ ... \]
    const singleMath = line.match(/^\s*\$\$(.+)\$\$\s*$/);
    if (singleMath) {
      root.appendChild(renderMath(singleMath[1].trim(), true));
      i += 1;
      continue;
    }
    if (/^\s*\$\$\s*$/.test(line) || /^\s*\\\[\s*$/.test(line)) {
      const isBracket = /^\s*\\\[/.test(line);
      const closeMathRe = isBracket ? /^\s*\\\]\s*$/ : /^\s*\$\$\s*$/;
      const mathLines = [];
      i += 1;
      while (i < lines.length && !closeMathRe.test(lines[i])) {
        mathLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      root.appendChild(renderMath(mathLines.join("\n").trim(), true));
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = Math.min(6, headingMatch[1].length);
      const h = document.createElement(`h${level}`);
      appendInline(h, headingMatch[2].trim());
      root.appendChild(h);
      i += 1;
      continue;
    }

    // Horizontal rule
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      root.appendChild(document.createElement("hr"));
      i += 1;
      continue;
    }

    // Blockquote
    if (/^\s*>\s?/.test(line)) {
      const quoteLines = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^\s*>\s?/, ""));
        i += 1;
      }
      const bq = document.createElement("blockquote");
      const inner = renderMarkdown(quoteLines.join("\n"));
      while (inner.firstChild) {
        bq.appendChild(inner.firstChild);
      }
      root.appendChild(bq);
      continue;
    }

    // Table
    if (line.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const headers = parseTableRow(line);
      i += 2; // skip header + separator
      const rows = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(parseTableRow(lines[i]));
        i += 1;
      }
      const wrap = document.createElement("div");
      wrap.className = "md-table-wrap";
      const table = document.createElement("table");
      const thead = document.createElement("thead");
      const trh = document.createElement("tr");
      for (const cell of headers) {
        const th = document.createElement("th");
        appendInline(th, cell);
        trh.appendChild(th);
      }
      thead.appendChild(trh);
      table.appendChild(thead);

      const tbody = document.createElement("tbody");
      for (const row of rows) {
        const tr = document.createElement("tr");
        for (let c = 0; c < headers.length; c += 1) {
          const td = document.createElement("td");
          appendInline(td, row[c] || "");
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      wrap.appendChild(table);
      root.appendChild(wrap);
      continue;
    }

    // Unordered or Ordered List (with indentation nesting)
    const listMatch = line.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
    if (listMatch) {
      const listStack = [];
      const isOrdered = (marker) => /\d+\./.test(marker);

      while (i < lines.length) {
        const lm = lines[i].match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
        if (!lm) {
          // Allow blank line between loose list items if next non-blank is a list item
          if (!lines[i].trim() && i + 1 < lines.length && /^(\s*)([-*+]|\d+\.)\s+/.test(lines[i + 1])) {
            i += 1;
            continue;
          }
          break;
        }
        const indent = lm[1].length;
        const ordered = isOrdered(lm[2]);
        const content = lm[3];

        while (listStack.length > 1 && indent < listStack[listStack.length - 1].indent) {
          listStack.pop();
        }

        if (listStack.length === 0 || indent > listStack[listStack.length - 1].indent) {
          const listEl = document.createElement(ordered ? "ol" : "ul");
          if (listStack.length === 0) {
            root.appendChild(listEl);
          } else {
            const parentLi = listStack[listStack.length - 1].lastLi || listStack[listStack.length - 1].el;
            parentLi.appendChild(listEl);
          }
          listStack.push({ indent, el: listEl, lastLi: null });
        }

        const top = listStack[listStack.length - 1];
        const li = document.createElement("li");
        appendInline(li, content);
        top.el.appendChild(li);
        top.lastLi = li;
        i += 1;
      }
      continue;
    }

    // Paragraph
    const paraLines = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*```/.test(lines[i]) &&
      !/^\s*\$\$/.test(lines[i]) &&
      !/^\s*\\\[/.test(lines[i]) &&
      !/^#{1,6}\s+/.test(lines[i]) &&
      !/^\s*>\s?/.test(lines[i]) &&
      !/^(\s*)([-*+]|\d+\.)\s+/.test(lines[i]) &&
      !/^\s*([-*_])\1{2,}\s*$/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i += 1;
    }
    const p = document.createElement("p");
    appendInline(p, paraLines.join(" "));
    root.appendChild(p);
  }

  return root;
}

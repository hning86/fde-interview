/**
 * Pure DOM/MathML TeX math renderer (zero innerHTML, zero external CDN dependencies).
 * Uses native MathML Core supported by Desktop Chrome and iPhone Safari.
 */

const MATHML_NS = "http://www.w3.org/1998/Math/MathML";

const SYMBOLS = {
  // Arrows
  to: "→",
  rightarrow: "→",
  leftarrow: "←",
  leftrightarrow: "↔",
  Rightarrow: "⇒",
  implies: "⟹",
  iff: "⟺",
  mapsto: "↦",
  // Relations & operators
  le: "≤",
  leq: "≤",
  ge: "≥",
  geq: "≥",
  ne: "≠",
  neq: "≠",
  approx: "≈",
  sim: "∼",
  equiv: "≡",
  ll: "≪",
  gg: "≫",
  cdot: "·",
  cdots: "⋯",
  dots: "…",
  ldots: "…",
  times: "×",
  pm: "±",
  mp: "∓",
  div: "÷",
  in: "∈",
  notin: "∉",
  subset: "⊂",
  subseteq: "⊆",
  supset: "⊃",
  supseteq: "⊇",
  cup: "∪",
  cap: "∩",
  emptyset: "∅",
  varnothing: "∅",
  infty: "∞",
  forall: "∀",
  exists: "∃",
  neg: "¬",
  land: "∧",
  lor: "∨",
  oplus: "⊕",
  otimes: "⊗",
  star: "⋆",
  circ: "∘",
  // Big operators
  sum: "∑",
  prod: "∏",
  int: "∫",
  bigcup: "⋃",
  bigcap: "⋂",
  // Delimiters
  lfloor: "⌊",
  rfloor: "⌋",
  lceil: "⌈",
  rceil: "⌉",
  langle: "⟨",
  rangle: "⟩",
  mid: "|",
  // Greek lowercase
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ϵ",
  varepsilon: "ε",
  zeta: "ζ",
  eta: "η",
  theta: "θ",
  iota: "ι",
  kappa: "κ",
  lambda: "λ",
  mu: "μ",
  nu: "ν",
  xi: "ξ",
  pi: "π",
  rho: "ρ",
  sigma: "σ",
  tau: "τ",
  upsilon: "υ",
  phi: "ϕ",
  varphi: "φ",
  chi: "χ",
  psi: "ψ",
  omega: "ω",
  // Greek uppercase
  Gamma: "Γ",
  Delta: "Δ",
  Theta: "Θ",
  Lambda: "Λ",
  Xi: "Ξ",
  Pi: "Π",
  Sigma: "Σ",
  Phi: "Φ",
  Psi: "Ψ",
  Omega: "Ω",
};

const FUNCTIONS = new Set([
  "log",
  "ln",
  "exp",
  "min",
  "max",
  "arg",
  "lim",
  "sup",
  "inf",
  "sin",
  "cos",
  "tan",
  "det",
  "gcd",
  "mod",
  "Pr",
  "dim",
]);

const TEXT_COMMANDS = new Set(["text", "textrm", "mathrm", "operatorname", "mathbf", "textbf", "mathcal", "mathbb"]);

const SPACING = {
  quad: "\u2001",
  qquad: "\u2001\u2001",
  ",": "\u2009",
  ";": "\u2005",
  ":": "\u2005",
  " ": "\u00A0",
  "!": "",
};

const ESCAPED_CHARS = {
  "%": "%",
  "_": "_",
  "{": "{",
  "}": "}",
  "$": "$",
  "&": "&",
  "#": "#",
  "|": "‖",
};

function mEl(tag, text) {
  const el = document.createElementNS(MATHML_NS, tag);
  if (text !== undefined) el.textContent = text;
  return el;
}

function tokenize(src) {
  const tokens = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === "\\") {
      i += 1;
      if (i >= n) break;
      if (/[a-zA-Z]/.test(src[i])) {
        let j = i;
        while (j < n && /[a-zA-Z]/.test(src[j])) j += 1;
        tokens.push({ type: "cmd", val: src.slice(i, j) });
        i = j;
      } else {
        tokens.push({ type: "cmd", val: src[i] });
        i += 1;
      }
      continue;
    }
    if ("{}^_".includes(ch)) {
      tokens.push({ type: ch, val: ch });
      i += 1;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      let j = i;
      while (j < n && /[0-9.]/.test(src[j])) j += 1;
      tokens.push({ type: "num", val: src.slice(i, j) });
      i = j;
      continue;
    }
    if (/[a-zA-Z]/.test(ch)) {
      tokens.push({ type: "id", val: ch });
      i += 1;
      continue;
    }
    tokens.push({ type: "op", val: ch });
    i += 1;
  }
  return tokens;
}

function parseTeXToMathML(src) {
  const tokens = tokenize(src);
  let pos = 0;

  function readRawBracedText() {
    // Re-read raw text inside {...} preserving spaces from original string isn't needed if we handle tokens cleanly;
    // reconstruct spaced text from tokens inside { ... }.
    if (pos >= tokens.length) return "";
    if (tokens[pos].type !== "{") {
      return tokens[pos++].val;
    }
    pos += 1; // skip '{'
    const parts = [];
    let depth = 1;
    while (pos < tokens.length && depth > 0) {
      const t = tokens[pos++];
      if (t.type === "{") {
        depth += 1;
      } else if (t.type === "}") {
        depth -= 1;
      } else if (t.type === "cmd") {
        parts.push(ESCAPED_CHARS[t.val] ?? SYMBOLS[t.val] ?? SPACING[t.val] ?? t.val);
      } else {
        parts.push(t.val);
      }
    }
    return parts.join("");
  }

  function parseAtom() {
    if (pos >= tokens.length) return mEl("mrow");
    const t = tokens[pos++];

    if (t.type === "{") {
      const row = mEl("mrow");
      while (pos < tokens.length && tokens[pos].type !== "}") {
        row.appendChild(parseScripted());
      }
      if (pos < tokens.length && tokens[pos].type === "}") pos += 1;
      return row.childNodes.length === 1 ? row.firstChild : row;
    }

    if (t.type === "num") return mEl("mn", t.val);
    if (t.type === "id") return mEl("mi", t.val);
    if (t.type === "op") return mEl("mo", t.val);

    if (t.type === "cmd") {
      const cmd = t.val;
      if (cmd === "left" || cmd === "right") {
        if (pos < tokens.length) {
          const delim = tokens[pos++];
          if (delim.val === ".") return mEl("mrow");
          const sym = delim.type === "cmd" ? (ESCAPED_CHARS[delim.val] ?? SYMBOLS[delim.val] ?? delim.val) : delim.val;
          return mEl("mo", sym);
        }
        return mEl("mrow");
      }
      if (cmd === "frac" || cmd === "dfrac" || cmd === "tfrac") {
        const num = parseAtom();
        const den = parseAtom();
        const frac = mEl("mfrac");
        frac.appendChild(num);
        frac.appendChild(den);
        return frac;
      }
      if (cmd === "binom" || cmd === "dbinom") {
        const top = parseAtom();
        const bot = parseAtom();
        const row = mEl("mrow");
        row.appendChild(mEl("mo", "("));
        const frac = mEl("mfrac");
        frac.setAttribute("linethickness", "0");
        frac.appendChild(top);
        frac.appendChild(bot);
        row.appendChild(frac);
        row.appendChild(mEl("mo", ")"));
        return row;
      }
      if (cmd === "sqrt") {
        // Optional [n] root index
        if (pos < tokens.length && tokens[pos].val === "[") {
          pos += 1;
          const idxRow = mEl("mrow");
          while (pos < tokens.length && tokens[pos].val !== "]") {
            idxRow.appendChild(parseScripted());
          }
          if (pos < tokens.length) pos += 1;
          const base = parseAtom();
          const mroot = mEl("mroot");
          mroot.appendChild(base);
          mroot.appendChild(idxRow);
          return mroot;
        }
        const sq = mEl("msqrt");
        sq.appendChild(parseAtom());
        return sq;
      }
      if (TEXT_COMMANDS.has(cmd)) {
        const txt = readRawBracedText();
        const el = mEl("mtext", txt);
        if (cmd === "mathbf" || cmd === "textbf") {
          el.setAttribute("mathvariant", "bold");
        }
        return el;
      }
      if (FUNCTIONS.has(cmd)) {
        const fn = mEl("mi", cmd);
        fn.setAttribute("mathvariant", "normal");
        return fn;
      }
      if (cmd in SYMBOLS) {
        return mEl("mo", SYMBOLS[cmd]);
      }
      if (cmd in ESCAPED_CHARS) {
        return mEl("mo", ESCAPED_CHARS[cmd]);
      }
      if (cmd in SPACING) {
        return mEl("mtext", SPACING[cmd]);
      }
      if (cmd === "\\") {
        return mEl("mspace");
      }
      return mEl("mtext", cmd);
    }

    return mEl("mo", t.val);
  }

  function parseScripted() {
    let base = parseAtom();
    let sub = null;
    let sup = null;

    while (pos < tokens.length && (tokens[pos].type === "_" || tokens[pos].type === "^")) {
      const kind = tokens[pos++].type;
      const arg = parseAtom();
      if (kind === "_" && !sub) sub = arg;
      else if (kind === "^" && !sup) sup = arg;
    }

    if (sub && sup) {
      const node = mEl("msubsup");
      node.appendChild(base);
      node.appendChild(sub);
      node.appendChild(sup);
      return node;
    }
    if (sub) {
      const node = mEl("msub");
      node.appendChild(base);
      node.appendChild(sub);
      return node;
    }
    if (sup) {
      const node = mEl("msup");
      node.appendChild(base);
      node.appendChild(sup);
      return node;
    }
    return base;
  }

  const rootRow = mEl("mrow");
  while (pos < tokens.length) {
    if (tokens[pos].type === "}") {
      pos += 1;
      continue;
    }
    rootRow.appendChild(parseScripted());
  }
  return rootRow;
}

/**
 * Render a TeX math expression into a safe DOM element wrapping native <math>.
 * Preserves whitespace inside \text{...} by pre-normalizing \text{...} spaces.
 * @param {string} tex
 * @param {boolean} displayMode
 * @returns {HTMLElement}
 */
export function renderMath(tex, displayMode = false) {
  // Preserve spaces inside \text{...} by converting them to non-breaking spaces before tokenizing
  const normalized = tex.replace(
    /\\(text|textrm|mathrm|operatorname|mathbf|textbf)\{([^{}]*)\}/g,
    (_, cmd, inner) => `\\${cmd}{${inner.replace(/ /g, "\u00A0")}}`
  );

  const math = document.createElementNS(MATHML_NS, "math");
  math.setAttribute("display", displayMode ? "block" : "inline");
  math.appendChild(parseTeXToMathML(normalized));

  if (displayMode) {
    const wrap = document.createElement("div");
    wrap.className = "md-math-block";
    wrap.appendChild(math);
    return wrap;
  }
  const span = document.createElement("span");
  span.className = "md-math-inline";
  span.appendChild(math);
  return span;
}

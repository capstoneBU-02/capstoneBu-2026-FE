// Colours and font for the tab SVG. They are plain SVG attributes, never CSS
// variables, so the PDF export (svg2pdf.js) reads the same picture.

// Same values as --ink-primary, --ink-tertiary, --border-strong and
// --console-muted in tokens.css.
export const TAB_COLORS = {
  ink: '#141412',
  secondary: '#75726b',
  line: '#c9c5bc',
  bar: '#a3a098',
  mask: '#fff',
} as const

// The PDF registers JetBrains Mono under this name, so it has to come first.
export const TAB_FONT =
  "'JetBrains Mono', 'SFMono-Regular', Consolas, monospace"

// jsPDF loads html2canvas, DOMPurify and canvg only for doc.html() and
// addSvgAsImage(), which the tab export never calls. The build puts this in
// their place, so they are not shipped (see vite.config.ts).
export default function notIncluded(): never {
  throw new Error('This part of jsPDF is not included')
}

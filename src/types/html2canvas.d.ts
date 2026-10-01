// html2canvas ships its own .d.ts files under dist/types, but its
// package.json has no "types" field pointing TypeScript at them, so
// module resolution can't find them automatically. This is a minimal
// ambient declaration covering just the options this app actually uses
// (see src/lib/render-report-pdf.ts) rather than pulling in the
// library's full internal Options type graph.
declare module "html2canvas" {
  interface Html2CanvasOptions {
    scale?: number;
    useCORS?: boolean;
    backgroundColor?: string | null;
    onclone?: (clonedDoc: Document) => void | Promise<void>;
  }

  function html2canvas(element: HTMLElement, options?: Html2CanvasOptions): Promise<HTMLCanvasElement>;
  export default html2canvas;
}

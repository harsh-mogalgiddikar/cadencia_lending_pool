import { Link } from 'react-router-dom';
export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-canvas text-ink p-6">
      <p className="eyebrow mb-4">404</p>
      <h1 className="text-7xl md:text-9xl tracking-tight mb-4">Lost in <span className="italic font-light">orbit</span>.</h1>
      <p className="text-muted-foreground mb-8">That page isn't part of the constellation.</p>
      <Link to="/" className="pill-ink">Back to home</Link>
    </div>
  );
}

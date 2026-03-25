export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-brand-900 text-white px-6 py-4 shadow-lg">
        <h1 className="font-heading text-xl tracking-wide">StoryPay Admin</h1>
      </header>
      <main>{children}</main>
    </div>
  );
}

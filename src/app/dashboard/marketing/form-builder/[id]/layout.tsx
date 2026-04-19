export default function FormBuilderEditLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="-mx-6 flex min-h-0 min-w-0 w-full max-w-none flex-1 flex-col sm:-mx-8 lg:-mx-10">
      {children}
    </div>
  );
}

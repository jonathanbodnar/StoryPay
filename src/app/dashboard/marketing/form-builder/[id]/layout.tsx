// The Flodesk-style form builder anchors itself to the dashboard's
// --sidebar-w CSS variable via position:fixed (matching the email
// builder), so this layout intentionally renders children unchanged.
export default function FormBuilderEditLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}

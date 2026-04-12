import { redirect } from 'next/navigation';
// Invoices live at /dashboard/invoices/new — redirect there
export default function PaymentsInvoicesPage() {
 redirect('/dashboard/invoices/new');
}

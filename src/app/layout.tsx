import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "StoryPay™ — Wedding Venue Payments by StoryVenue",
  description: "Payment management platform for wedding venues",
  icons: {
    icon: [
      { url: '/461713460_122100220862551020_978094103341106299_n.jpg', type: 'image/jpeg' },
    ],
    apple: '/461713460_122100220862551020_978094103341106299_n.jpg',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased bg-white text-gray-900">{children}</body>
    </html>
  );
}

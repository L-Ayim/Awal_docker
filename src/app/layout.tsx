import type { Metadata } from "next";
import { Poppins } from "next/font/google";
import "./globals.css";
import { appEnv } from "@/lib/env";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-poppins"
});

export const metadata: Metadata = {
  title: appEnv.APP_NAME,
  description: "Document-grounded chatbot runtime for Awal."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={poppins.variable}>{children}</body>
    </html>
  );
}

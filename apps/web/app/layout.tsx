import type { Metadata } from "next";
import { Public_Sans } from "next/font/google";
import PlausibleProvider from "next-plausible";
import "./globals.css";

const publicSans = Public_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
  variable: "--font-public-sans",
});

export const metadata: Metadata = {
  title: "Ask Arthur — Free AI Scam Checker",
  description:
    "Paste a suspicious message, email, or URL and get an instant AI-powered verdict. Free, private, no signup required.",
  openGraph: {
    title: "Ask Arthur — Free AI Scam Checker",
    description:
      "Paste a suspicious message and find out if it's a scam — instantly, for free.",
    url: "https://askarthur.au",
    siteName: "Ask Arthur",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Ask Arthur — Free AI Scam Checker",
    description:
      "Paste a suspicious message and find out if it's a scam — instantly, for free.",
  },
  robots: "index, follow",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`light ${publicSans.variable}`}>
      <head>
        <PlausibleProvider domain={process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN || "askarthur.au"} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0&icon_names=account_balance,arrow_back,article,attach_file,bolt,cancel,check,check_circle,checklist,close,computer,content_paste,emergency,error,error_outline,expand_less,expand_more,favorite,flag,folder_open,globe,gpp_bad,language,link,local_shipping,lock,mail,mic,open_in_new,pending,person,person_off,phone,phone_android,phone_in_talk,phishing,photo_camera,photo_library,priority_high,qr_code_scanner,radio_button_unchecked,remove_circle_outline,router,schedule,search_off,security,shield,speed,support,trending_up,verified,verified_user,videocam_off,visibility_off,warning&display=block"
          rel="stylesheet"
        />
      </head>
      <body className="bg-white text-gov-slate antialiased">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-deep-navy focus:text-white focus:px-4 focus:py-2 focus:rounded"
        >
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}

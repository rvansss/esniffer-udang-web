import './globals.css';
import Header from '../components/layout/Header'; 

export const metadata = {
  title: 'E-Sniffer Dashboard',
  description: 'Monitoring Gas Berbasis IoT',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id">
      {/* Body dibiarkan bersih dari warna background agar tidak bentrok dengan globals.css */}
      <body className="text-white font-sans antialiased selection:bg-cyan-500/30">
        
        {/* INI KUNCI VISUALNYA: Menggunakan div pembungkus yang persis seperti page.tsx aslimu */}
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-[#1e3a8a] to-indigo-950 flex flex-col relative overflow-hidden">
          
          {/* Background Orbs dikembalikan ke posisi absolute */}
          <div className="absolute top-0 left-20 w-96 h-96 bg-blue-500 rounded-full mix-blend-screen filter blur-[120px] opacity-40 animate-pulse pointer-events-none z-0"></div>
          <div className="absolute bottom-10 right-20 w-96 h-96 bg-cyan-400 rounded-full mix-blend-screen filter blur-[120px] opacity-20 pointer-events-none z-0"></div>

          {/* Kontainer Utama */}
          <div className="relative z-10 flex flex-col min-h-screen p-4 md:p-8 max-w-[1440px] mx-auto w-full gap-6">
            <Header />
            
            <main className="flex-1 w-full flex flex-col gap-6">
              {children}
            </main>

            <footer className="py-6 text-center text-xs font-mono font-bold text-white/50 tracking-widest">
              *E-Sniffer n Team 2026
            </footer>
          </div>

        </div>
      </body>
    </html>
  );
}
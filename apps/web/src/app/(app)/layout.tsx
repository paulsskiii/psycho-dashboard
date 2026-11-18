import { Nav } from "@/components/ui/Nav";

import s from "./shell.module.css";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={s.shell}>
      {children}
      <Nav />
    </div>
  );
}

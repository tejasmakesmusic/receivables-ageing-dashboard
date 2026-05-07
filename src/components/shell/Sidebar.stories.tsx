import { Sidebar } from "@/components/shell/Sidebar";

const meta = {
  title: "Shell/Sidebar",
  component: Sidebar,
};

export default meta;

export function Default() {
  return (
    <div className="h-[760px] overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)]">
      <Sidebar />
    </div>
  );
}

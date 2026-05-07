import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

const meta = {
  title: "Tokens/Button",
  component: Button,
};

export default meta;

export function Primary() {
  return <Button>Publish snapshot</Button>;
}

export function Secondary() {
  return <Button variant="secondary">Export ageing</Button>;
}

export function Loading() {
  return (
    <Button disabled>
      <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
      Saving
    </Button>
  );
}

export function Disabled() {
  return <Button disabled>Publish snapshot</Button>;
}

export function Destructive() {
  return (
    <Button variant="destructive">
      <Trash2 aria-hidden="true" className="h-4 w-4" />
      Delete draft
    </Button>
  );
}

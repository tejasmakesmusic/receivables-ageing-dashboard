import { SavedViewSwitcher } from "@/components/saved-views/saved-view-switcher";

const meta = {
  title: "Tables/SavedViewSwitcher",
  component: SavedViewSwitcher,
};

export default meta;

export function Empty() {
  return <SavedViewSwitcher currentUserRole="ANALYST" surface="invoices" />;
}

export function WithViews() {
  return <SavedViewSwitcher currentUserRole="ADMIN" surface="invoices" />;
}

import AuthGate from "@/components/AuthGate";
import ShippingReport from "@/components/ShippingReport";

export default function ShippingPage() {
  return (
    <AuthGate>
      <ShippingReport />
    </AuthGate>
  );
}

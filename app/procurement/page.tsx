import AuthGate from "@/components/AuthGate";
import Procurement from "@/components/Procurement";

export default function ProcurementPage() {
  return (
    <AuthGate>
      <Procurement />
    </AuthGate>
  );
}

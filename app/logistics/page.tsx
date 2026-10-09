import AuthGate from "@/components/AuthGate";
import Logistics from "@/components/Logistics";

export default function LogisticsPage() {
  return (
    <AuthGate>
      <Logistics />
    </AuthGate>
  );
}

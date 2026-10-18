import AuthGate from "@/components/AuthGate";
import LogisticsBundle from "@/components/LogisticsBundle";

export default function LogisticsAllPage() {
  return (
    <AuthGate>
      <LogisticsBundle />
    </AuthGate>
  );
}

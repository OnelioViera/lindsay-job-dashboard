import AuthGate from "@/components/AuthGate";
import Tracker from "@/components/Tracker";

export default function StructuresPage() {
  return (
    <AuthGate>
      <Tracker />
    </AuthGate>
  );
}

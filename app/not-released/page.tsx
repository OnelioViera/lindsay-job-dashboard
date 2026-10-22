import AuthGate from "@/components/AuthGate";
import NotReleased from "@/components/NotReleased";

export default function NotReleasedPage() {
  return (
    <AuthGate>
      <NotReleased />
    </AuthGate>
  );
}

import DailyNicheDashboard from "@/components/niche/DailyNicheDashboard";

export default async function NicheDashboardPage() {
  // Pass your active user ID and subscription plan tier dynamically
  return <DailyNicheDashboard userId="user_id_here" userPlan="pro" />;
}
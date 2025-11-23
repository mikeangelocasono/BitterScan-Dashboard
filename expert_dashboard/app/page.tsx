import { redirect } from "next/navigation";

// Force dynamic rendering to avoid static generation issues
export const dynamic = 'force-dynamic';

export default function Home() {
  redirect("/login");
}
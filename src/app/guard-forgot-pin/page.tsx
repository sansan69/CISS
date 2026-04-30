import { redirect } from "next/navigation";

export default function GuardForgotPinPage() {
  redirect("/guard-login/reset");
}

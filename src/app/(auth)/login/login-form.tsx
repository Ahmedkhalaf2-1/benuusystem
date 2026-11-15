"use client";

import { useActionState, useState } from "react";
import { AlertCircle, Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginSchema } from "@/lib/validations/auth";
import { loginAction, type LoginFormState } from "./actions";

const initialState: LoginFormState = {};

export function LoginForm() {
  const [state, formAction, pending] = useActionState(loginAction, initialState);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  // Instant client-side checks; the server validates again regardless.
  const [clientErrors, setClientErrors] = useState<LoginFormState["fieldErrors"]>();

  const fieldErrors = clientErrors ?? state.fieldErrors;
  const emailError = fieldErrors?.email?.[0];
  const passwordError = fieldErrors?.password?.[0];
  const formMessage = clientErrors ? undefined : state.message;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    const parsed = loginSchema.safeParse({ email, password });
    if (parsed.success) {
      setClientErrors(undefined);
      return;
    }
    event.preventDefault();
    const errors: NonNullable<LoginFormState["fieldErrors"]> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (field === "email" || field === "password") (errors[field] ??= []).push(issue.message);
    }
    setClientErrors(errors);
  }

  return (
    <form action={formAction} onSubmit={handleSubmit} noValidate className="space-y-5">
      {formMessage && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-2xl bg-red-soft p-3.5 text-sm font-medium text-red"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{formMessage}</span>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="email" className="text-[0.95rem]">
          البريد الإلكتروني
        </Label>
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          dir="ltr"
          placeholder="name@example.com"
          className="text-left"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            setClientErrors(undefined);
          }}
          aria-invalid={emailError ? true : undefined}
          aria-describedby={emailError ? "email-error" : undefined}
          disabled={pending}
        />
        {emailError && (
          <p id="email-error" className="text-sm text-destructive">
            {emailError}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="password" className="text-[0.95rem]">
          كلمة المرور
        </Label>
        <div className="relative">
          <Input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            dir="ltr"
            className="pe-3.5 ps-12 text-left"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              setClientErrors(undefined);
            }}
            aria-invalid={passwordError ? true : undefined}
            aria-describedby={passwordError ? "password-error" : undefined}
            disabled={pending}
          />
          <button
            type="button"
            onClick={() => setShowPassword((value) => !value)}
            className="absolute inset-y-0 left-0 flex w-12 items-center justify-center rounded-l-xl text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
            aria-pressed={showPassword}
          >
            {showPassword ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
          </button>
        </div>
        {passwordError && (
          <p id="password-error" className="text-sm text-destructive">
            {passwordError}
          </p>
        )}
      </div>

      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? (
          <>
            <Loader2 className="size-5 animate-spin" aria-hidden="true" />
            جارٍ تسجيل الدخول…
          </>
        ) : (
          "تسجيل الدخول"
        )}
      </Button>
    </form>
  );
}

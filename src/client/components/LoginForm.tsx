import { Button, Label, Text } from "@cloudflare/kumo";
import { Eye, EyeSlash } from "@phosphor-icons/react";
import { useState } from "react";
import { login } from "../lib/api";

interface Props {
  onSuccess: () => void;
}

const passwordStyles = `
input[type="password"]::-webkit-reveal-button,
input[type="password"]::-webkit-credentials-auto-fill-button {
  display: none !important;
}
input[type="password"]::-ms-reveal {
  display: none !important;
}
`;

export default function LoginForm({ onSuccess }: Props) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(password);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <style>{passwordStyles}</style>
      <div className="flex min-h-dvh items-center justify-center p-6">
        <form
          onSubmit={handleSubmit}
          className="w-full max-w-sm rounded-lg border border-kumo-line bg-kumo-elevated p-6 shadow-sm"
        >
          <Text variant="heading3" as="h1" DANGEROUS_className="m-0">
            OpenCode Go 多账号看板
          </Text>
          <Text variant="secondary" as="p" DANGEROUS_className="m-0 mt-2 text-sm">
            输入管理密码查看账号用量。
          </Text>

          <div className="mt-5 flex flex-col gap-1.5">
            <Label htmlFor="admin-password">管理密码</Label>
            <div className="relative">
              <input
                id="admin-password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="请输入密码..."
                autoComplete="current-password"
                autoFocus
                onCopy={(e) => e.preventDefault()}
                onCut={(e) => e.preventDefault()}
                className="block w-full rounded-lg border border-kumo-line bg-kumo-bg px-3 py-2 text-sm text-kumo-text placeholder:text-kumo-subtle focus:outline-none focus:ring-2 focus:ring-kumo-focus"
                style={{ paddingRight: 36 }}
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center w-6 h-6 text-kumo-subtle hover:text-kumo-text cursor-pointer"
                aria-label={showPassword ? "隐藏密码" : "显示密码"}
              >
                {showPassword ? <EyeSlash size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {error ? (
            <Text
              variant="secondary"
              as="p"
              DANGEROUS_className="m-0 mt-3 text-sm text-kumo-danger"
            >
              {error}
            </Text>
          ) : null}

          <Button
            type="submit"
            variant="primary"
            className="mt-5 w-full"
            disabled={loading || !password}
          >
            {loading ? "登录中…" : "登录"}
          </Button>
        </form>
      </div>
    </>
  );
}
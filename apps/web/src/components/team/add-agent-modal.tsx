import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { DEFAULT_ROLE_NAMES } from "@kaneo/permissions";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod/v4";
import useCreateAgent from "@/hooks/mutations/agent/use-create-agent";
import { toast } from "@/lib/toast";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "../ui/form";
import { Input } from "../ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";

type Props = {
  open: boolean;
  onClose: () => void;
  workspaceId: string;
};

const agentFormSchema = z.object({
  name: z.string().trim().min(1),
  role: z.enum(DEFAULT_ROLE_NAMES),
});

type AgentFormValues = z.infer<typeof agentFormSchema>;

function AddAgentModal({ open, onClose, workspaceId }: Props) {
  const { t } = useTranslation();
  const { mutateAsync, isPending } = useCreateAgent();
  const [createdAgent, setCreatedAgent] = useState<{
    name: string;
    apiKey: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const form = useForm<AgentFormValues>({
    resolver: standardSchemaResolver(agentFormSchema),
    defaultValues: { name: "", role: "member" },
  });

  const onSubmit = async ({ name, role }: AgentFormValues) => {
    try {
      const result = await mutateAsync({ workspaceId, name, role });
      setCreatedAgent({ name: result.user.name, apiKey: result.apiKey });
      form.reset();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("team:addAgentModal.error"),
      );
    }
  };

  const handleCopy = () => {
    if (!createdAgent) return;
    navigator.clipboard.writeText(createdAgent.apiKey);
    setCopied(true);
    toast.success(t("team:addAgentModal.toastCopied"));
  };

  const resetAndClose = () => {
    setCreatedAgent(null);
    setCopied(false);
    form.reset();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={resetAndClose}>
      <DialogPopup className="w-full max-w-md">
        <DialogHeader>
          <DialogTitle>
            {createdAgent
              ? t("team:addAgentModal.createdTitle")
              : t("team:addAgentModal.title")}
          </DialogTitle>
        </DialogHeader>

        {createdAgent ? (
          <>
            <DialogPanel className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {t("team:addAgentModal.createdDescription", {
                  name: createdAgent.name,
                })}
              </p>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium">
                    {t("team:addAgentModal.apiKeyLabel")}
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleCopy}
                    className="h-7 gap-1.5 text-xs"
                  >
                    {copied ? (
                      <>
                        <Check className="h-3 w-3 text-success-foreground" />
                        {t("team:addAgentModal.copied")}
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" />
                        {t("team:addAgentModal.copy")}
                      </>
                    )}
                  </Button>
                </div>
                <div className="bg-sidebar border border-border rounded-sm p-2.5 max-h-24 overflow-y-auto">
                  <code className="text-xs font-mono text-foreground break-all leading-relaxed">
                    {createdAgent.apiKey}
                  </code>
                </div>
              </div>
              <Alert>
                <AlertTitle>{t("team:addAgentModal.alertTitle")}</AlertTitle>
                <AlertDescription>
                  {t("team:addAgentModal.alertDescription")}
                </AlertDescription>
              </Alert>
            </DialogPanel>
            <DialogFooter>
              <Button
                size="sm"
                onClick={resetAndClose}
                disabled={!copied}
                className="w-full sm:w-auto"
              >
                {copied
                  ? t("team:addAgentModal.done")
                  : t("team:addAgentModal.copyToContinue")}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="contents">
              <DialogPanel className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("team:addAgentModal.nameLabel")}</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          placeholder={t("team:addAgentModal.namePlaceholder")}
                          autoFocus
                          disabled={isPending}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="role"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("team:addAgentModal.roleLabel")}</FormLabel>
                      <FormControl>
                        <Select
                          onValueChange={field.onChange}
                          value={field.value}
                          disabled={isPending}
                        >
                          <SelectTrigger>
                            <SelectValue>
                              {t(`team:roles.${field.value}`)}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {DEFAULT_ROLE_NAMES.map((role) => (
                              <SelectItem key={role} value={role}>
                                {t(`team:roles.${role}`)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </DialogPanel>
              <DialogFooter>
                <DialogClose
                  render={<Button variant="outline" size="sm" type="button" />}
                >
                  {t("common:actions.cancel")}
                </DialogClose>
                <Button type="submit" size="sm" disabled={isPending}>
                  {isPending
                    ? t("team:addAgentModal.creating")
                    : t("team:addAgentModal.create")}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        )}
      </DialogPopup>
    </Dialog>
  );
}

export default AddAgentModal;

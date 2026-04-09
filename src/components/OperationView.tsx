import { OperationState } from "./operations";
import "./OperationView.css";
import { Modal } from "./Modal";
import {
  FaCircleExclamation,
  FaCircleCheck,
  FaCircleMinus,
} from "react-icons/fa6";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Trans, useTranslation } from "react-i18next";
import { ErrorVariant, getErrorSuggestions } from "../errors";
import { useStore } from "../StoreContext";
import { usePlatform } from "../PlatformContext";

export default ({
  operationState,
  closeMenu,
}: {
  operationState: OperationState;
  closeMenu: () => void;
}) => {
  const { t } = useTranslation();
  const operation = operationState.current;
  const opFailed = operationState.failed.length > 0;
  const done =
    (opFailed &&
      operationState.started.length ==
        operationState.completed.length + operationState.failed.length) ||
    operationState.completed.length == operation.steps.length;

  const currentStep = done
    ? null
    : operation.steps.find((step) => {
        const failed = operationState.failed.some((f) => f.stepId === step.id);
        const completed = operationState.completed.includes(step.id);
        const started = operationState.started.includes(step.id);
        return started && !completed && !failed;
      }) ??
      operation.steps.find((step) => {
        const failed = operationState.failed.some((f) => f.stepId === step.id);
        const completed = operationState.completed.includes(step.id);
        const started = operationState.started.includes(step.id);
        return !failed && !completed && !started;
      }) ??
      null;

  const defaultStepWeight = 1;
  const sideloadStepWeights: Record<string, number> = {
    prepare: 1,
    cert: 2,
    profile: 2,
    sign: 2,
    transfer: 5,
  };

  const getStepWeight = (stepId: string) =>
    operation.id === "sideload"
      ? (sideloadStepWeights[stepId] ?? defaultStepWeight)
      : defaultStepWeight;

  const totalWeight = operation.steps.reduce(
    (sum, step) => sum + getStepWeight(step.id),
    0,
  );

  const weightedProgress = operation.steps.reduce((sum, step) => {
    const weight = getStepWeight(step.id);
    const failed = operationState.failed.some((f) => f.stepId === step.id);
    const completed = operationState.completed.includes(step.id);
    const started = operationState.started.includes(step.id);
    const reported = operationState.progress[step.id] ?? 0;

    if (failed || completed) return sum + weight;
    if (started) return sum + weight * Math.max(0.02, Math.min(0.98, reported));
    return sum;
  }, 0);

  const progressPercent =
    totalWeight > 0
      ? Math.min(100, Math.round(((done ? totalWeight : weightedProgress) / totalWeight) * 100))
      : 0;

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const transferInfo = operationState.transferBytes["transfer"];

  const displayStepText =
    currentStep?.id === "transfer" && transferInfo
      ? `${t(currentStep.titleKey)} (${formatBytes(transferInfo.uploaded)}/${formatBytes(transferInfo.total)})`
      : currentStep
        ? t(currentStep.titleKey)
        : done
          ? t("operation.completed")
          : t("operation.preparing");

  const [moreDetailsOpen, setMoreDetailsOpen] = useState(false);
  const [anisetteServer] = useStore<string>(
    "anisetteServer",
    "ani.sidestore.io",
  );
  const { platform } = usePlatform();
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [underage, setUnderage] = useState<boolean>(false);

  const getSuggestions = useCallback(
    (type: ErrorVariant): string[] => {
      return getErrorSuggestions(t, type, platform, anisetteServer);
    },
    [anisetteServer, t, platform],
  );

  useEffect(() => {
    if (operationState.failed.length > 0) {
      const suggestionSet = new Set<string>();
      for (let f of operationState.failed) {
        if (f.extraDetails.type === "underage") {
          setUnderage(true);
        }
        for (const suggestion of getSuggestions(f.extraDetails.type)) {
          suggestionSet.add(suggestion);
        }
      }
      setSuggestions([...suggestionSet]);
    }
  }, [operationState, getSuggestions]);

  return (
    <Modal
      isOpen={true}
      close={() => {
        if (done) closeMenu();
      }}
      hideClose={!done}
      sizeFit
    >
      <div className="operation-header">
        <h2>
          {done && !opFailed && operation.successTitleKey
            ? t(operation.successTitleKey)
            : t(operation.titleKey)}
        </h2>
        <p>
          {done
            ? opFailed
              ? t("operation.failed")
              : t("operation.completed")
            : t("operation.please_wait")}
        </p>
        <div className="operation-progress" aria-hidden={done}>
          <div className="operation-progress-bar">
            <div
              className="operation-progress-fill"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <div className="operation-progress-meta">
            <span className="operation-progress-percent">{progressPercent}%</span>
            <span className="operation-progress-step">{displayStepText}</span>
          </div>
        </div>
      </div>
      <div className="operation-content-container">
        <div className="operation-content">
          {(operation.id === "sideload"
            ? [{ id: "install", titleKey: "operations.sideload_step_install" }]
            : operation.steps
          ).map((step) => {
            const stepIds =
              operation.id === "sideload"
                ? ["prepare", "sign", "transfer", "install"]
                : [step.id];

            let failed = operationState.failed.find((f) => stepIds.includes(f.stepId));
            let completed = stepIds.every((id) => operationState.completed.includes(id));
            let started = stepIds.some((id) => operationState.started.includes(id));
            let notStarted = !failed && !completed && !started;

            // a little bit gross but it gets the job done.
            let lines =
              failed?.extraDetails.message
                ?.split("\n")
                .filter((line) => line.includes("●")) ?? [];
            let errorShort =
              lines[lines.length - 1]?.replace(/●\s*/, "").trim() ?? "";

            return (
              <div className="operation-step" key={step.id}>
                <div className="operation-step-icon">
                  {failed && (
                    <FaCircleExclamation className="operation-error" />
                  )}
                  {!failed && completed && (
                    <FaCircleCheck className="operation-check" />
                  )}
                  {!failed && !completed && started && (
                    <div className="loading-icon" />
                  )}
                  {notStarted && !opFailed && <div className="waiting-icon" />}
                  {notStarted && opFailed && (
                    <FaCircleMinus className="operation-skipped" />
                  )}
                </div>

                <div className="operation-step-internal">
                  <p>{operation.id === "sideload" ? displayStepText : t(step.titleKey)}</p>
                  {failed && (
                    <>
                      <pre className="operation-extra-details">
                        {!errorShort
                          ? failed.extraDetails.message.replace(/^\n+/, "")
                          : errorShort}
                      </pre>
                      {errorShort !== "" &&
                        errorShort !== null &&
                        errorShort !== undefined && (
                          <>
                            <p
                              className="operation-more-details"
                              role="button"
                              tabIndex={0}
                              onClick={() =>
                                setMoreDetailsOpen(!moreDetailsOpen)
                              }
                            >
                              {t("common.more_details")}{" "}
                              {moreDetailsOpen ? "▲" : "▼"}
                            </p>
                            {moreDetailsOpen && (
                              <pre className="operation-extra-details">
                                {failed.extraDetails.message.replace(
                                  /^\n+/,
                                  "",
                                )}
                              </pre>
                            )}
                          </>
                        )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {done && !opFailed && operation.successMessageKey && (
        <p className="operation-success-message">
          {t(operation.successMessageKey!)}
        </p>
      )}
      {done && !(!opFailed && operation.successMessageKey) && <p></p>}
      {opFailed && done && (
        <div className="operation-suggestions">
          {suggestions.length > 0 && <h3>{t("error.suggestions_heading")}</h3>}
          {suggestions.length > 0 && (
            <ul>
              {suggestions.map((s) => (
                <li key={s}>
                  {
                    // replace ((link:URL)) with a clickable link but still keep it as li
                    s.split(/(\(\(link:[^)]+\)\))/g).map((part, index) => {
                      const match = part.match(/\(\(link:([^)]+)\)\)/);
                      if (match) {
                        const url = match[1];
                        return (
                          <span
                            key={index}
                            onClick={() => openUrl(url)}
                            role="link"
                            className="error-link"
                          >
                            {url}
                          </span>
                        );
                      }
                      return <span key={index}>{part}</span>;
                    })
                  }
                </li>
              ))}
            </ul>
          )}
          {!underage && (
            <p>
              <Trans
                i18nKey="error.support_message"
                components={{
                  discord: (
                    <span
                      onClick={() => openUrl("https://discord.gg/EA6yVgydBz")}
                      role="link"
                      className="error-link"
                    />
                  ),
                  github: (
                    <span
                      onClick={() =>
                        openUrl("https://github.com/nab138/iloader/issues")
                      }
                      role="link"
                      className="error-link"
                    />
                  ),
                }}
              />
            </p>
          )}
          <button
            style={{ width: "100%" }}
            className="action-button primary"
            onClick={() => {
              navigator.clipboard.writeText(
                "```\n" +
                  (operationState.failed[0]?.extraDetails?.message.replace(
                    /^\n+/,
                    "",
                  ) ?? t("common.no_error")) +
                  "\n```",
              );
              toast.success(t("common.copied_success"));
            }}
          >
            {t("operation.copy_error_clipboard")}
          </button>
        </div>
      )}
      {done && (
        <button style={{ width: "100%" }} onClick={closeMenu}>
          {t("common.dismiss")}
        </button>
      )}
    </Modal>
  );
};

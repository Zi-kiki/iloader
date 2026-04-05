use rootcause::Report;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, thiserror::Error, Clone)]
pub enum AppError {
    #[error("Failed to emit status to frontend: {0}")]
    OperationUpdate(String),
    #[error("{0}")]
    DeviceComs(String, String),
    #[error("{0}")]
    Usbmuxd(String, String),
    #[error("Not logged in")]
    NotLoggedIn,
    #[error("No device selected")]
    NoDeviceSelected,
    #[error("{0}")]
    Anisette(String),
    #[error("Keyring error: {0} - {1}")]
    Keyring(String, String),
    #[error("{0}")]
    Misc(String),
}

// from rootcause report
impl From<Report> for AppError {
    fn from(report: Report) -> Self {
        for cause in report.iter_reports() {
            if let Some(msg) = cause.downcast_current_context::<String>() {
                if msg.contains("Failed to get anisette data for login") {
                    return AppError::Anisette(msg.clone());
                }
            }
        }
        AppError::Misc(format!("{report:?}"))
    }
}

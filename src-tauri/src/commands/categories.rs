//! Category commands — thin wrappers over `db::categories`, using the managed `DbState`.

use serde::Deserialize;
use tauri::State;

use crate::db::categories;
use crate::domain::category::{Category, CategoryKind};
use crate::error::AppError;
use crate::state::DbState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewCategory {
    pub name: String,
    pub parent_id: Option<i64>,
    pub kind: CategoryKind,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCategory {
    pub id: i64,
    pub name: String,
    pub parent_id: Option<i64>,
    pub kind: CategoryKind,
}

#[tauri::command]
pub fn list_categories(
    state: State<'_, DbState>,
    include_archived: Option<bool>,
) -> Result<Vec<Category>, AppError> {
    state.with(|c| categories::list(c, include_archived.unwrap_or(false)))
}

#[tauri::command]
pub fn create_category(
    state: State<'_, DbState>,
    category: NewCategory,
) -> Result<Category, AppError> {
    state.with(|c| categories::create(c, &category.name, category.parent_id, category.kind))
}

#[tauri::command]
pub fn update_category(
    state: State<'_, DbState>,
    category: UpdateCategory,
) -> Result<Category, AppError> {
    state.with(|c| {
        categories::update(c, category.id, &category.name, category.parent_id, category.kind)
    })
}

#[tauri::command]
pub fn archive_category(state: State<'_, DbState>, id: i64) -> Result<(), AppError> {
    state.with(|c| categories::archive(c, id))
}

use crate::connect::unary;
use crate::proto::*;

const INITIALIZE: &str = "/fantasia.v1.OrchestratorService/Initialize";
const SUBMIT: &str = "/fantasia.v1.OrchestratorService/Submit";
const GET_STATUS: &str = "/fantasia.v1.OrchestratorService/GetStatus";
const GET_COST: &str = "/fantasia.v1.OrchestratorService/GetCost";

pub async fn initialize(socket: &str, config: OrchestratorConfig) -> anyhow::Result<()> {
    let req = InitializeRequest {
        config: Some(config),
    };
    unary::unary::<_, InitializeResponse>(socket, INITIALIZE, &req).await?;
    Ok(())
}

pub async fn submit(socket: &str, user_message: String) -> anyhow::Result<()> {
    let req = SubmitRequest { user_message };
    unary::unary::<_, SubmitResponse>(socket, SUBMIT, &req).await?;
    Ok(())
}

pub async fn get_status(socket: &str) -> anyhow::Result<GetStatusResponse> {
    unary::unary(socket, GET_STATUS, &GetStatusRequest {}).await
}

pub async fn get_cost(socket: &str) -> anyhow::Result<GetCostResponse> {
    unary::unary(socket, GET_COST, &GetCostRequest {}).await
}

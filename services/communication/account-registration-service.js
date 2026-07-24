const notificationService = require("./notification-service");

async function dispatch(event, context, actor) {
  try {
    return await notificationService.trigger(
      event,
      {
        ...(context || {}),
        trigger: event,
        skipSystemDispatch: true,
      },
      actor || "crm-admin",
    );
  } catch (error) {
    console.error(`Registration notification ${event} failed:`, error.message);
    return [];
  }
}

module.exports = { dispatch };

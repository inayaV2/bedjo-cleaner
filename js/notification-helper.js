(function () {
  async function createNotification(data) {
    const notificationPayload = {
      type: data?.type || "order_status_updated",
      title: data?.title || "Notification",
      message: data?.message || "",
      order_id: data?.order_id || null,
      order_code: data?.order_code || null,
      customer_name: data?.customer_name || null,
      customer_phone: data?.customer_phone || null,
      is_read: false,
      created_at: new Date().toISOString(),
    };

    console.log("insert notification payload:", notificationPayload);

    try {
      const result = await supabaseClient
        .from("notifications")
        .insert(notificationPayload);

      console.log("insert notification result:", result);

      if (result.error) {
        console.error("insert notification error:", result.error);
      }

      return result;
    } catch (error) {
      console.error("insert notification exception:", error);
      return { data: null, error };
    }
  }

  window.BedjoNotification = {
    createNotification,
  };
})();

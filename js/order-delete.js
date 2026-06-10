(function () {
  const CONFIRM_MESSAGE = "Yakin ingin menghapus order ini? Data order, payment, item, foto, dan tracking akan ikut terhapus.";

  async function deleteOrder(orderId, options = {}) {
    if (!orderId) throw new Error("ID order tidak tersedia.");

    const profile = options.profile || {};
    const session = options.session || {};
    const role = String(profile.role || session.role || "").toLowerCase();
    const branchId = profile.branch_id || session.branch_id || null;

    let orderQuery = supabaseClient
      .from("orders")
      .select("id, order_code, branch_id")
      .eq("id", orderId);

    if (role === "operator") {
      if (!branchId) throw new Error("Branch operator belum diset.");
      orderQuery = orderQuery.eq("branch_id", branchId);
    }

    const { data: targetOrder, error: orderError } = await orderQuery.maybeSingle();
    if (orderError) throw orderError;
    if (!targetOrder) throw new Error("Order tidak ditemukan atau bukan milik branch operator ini.");

    const [
      paymentsResult,
      photosResult,
    ] = await Promise.all([
      supabaseClient.from("payments").select("id").eq("order_id", targetOrder.id),
      supabaseClient.from("order_photos").select("id, file_path").eq("order_id", targetOrder.id),
    ]);

    if (paymentsResult.error) throw paymentsResult.error;
    if (photosResult.error) throw photosResult.error;

    const paymentIds = (paymentsResult.data || []).map(row => row.id).filter(Boolean);
    let paymentProofs = [];

    if (paymentIds.length) {
      const proofResult = await supabaseClient
        .from("payment_proofs")
        .select("id, payment_id, file_path")
        .in("payment_id", paymentIds);
      if (proofResult.error) throw proofResult.error;
      paymentProofs = proofResult.data || [];
    }

    await removeStorageFiles(
      "order-photos",
      (photosResult.data || []).map(row => row.file_path)
    );
    await removeStorageFiles(
      "payment-proofs",
      paymentProofs.map(row => row.file_path)
    );

    if (paymentIds.length) {
      await deleteByIn("payment_proofs", "payment_id", paymentIds);
    }
    await deleteByEq("payments", "order_id", targetOrder.id);
    await deleteByEq("order_photos", "order_id", targetOrder.id);
    await deleteByEq("order_items", "order_id", targetOrder.id);
    await deleteByEq("notifications", "order_id", targetOrder.id);
    await deleteOptionalByEq("reviews", "order_id", targetOrder.id);

    let finalDelete = supabaseClient
      .from("orders")
      .delete()
      .eq("id", targetOrder.id);

    if (role === "operator") {
      finalDelete = finalDelete.eq("branch_id", branchId);
    }

    const { data: deletedOrder, error: finalError } = await finalDelete
      .select("id")
      .maybeSingle();

    if (finalError) throw finalError;
    if (!deletedOrder) throw new Error("Order gagal dihapus atau akses branch ditolak.");

    await insertActivityLog(targetOrder.order_code, profile.email || session.email || "");
    return targetOrder;
  }

  async function removeStorageFiles(bucketName, paths) {
    const uniquePaths = [...new Set((paths || []).filter(Boolean))];
    if (!uniquePaths.length) return;

    const { error } = await supabaseClient.storage
      .from(bucketName)
      .remove(uniquePaths);

    if (error) throw error;
  }

  async function deleteByEq(table, column, value) {
    const { error } = await supabaseClient
      .from(table)
      .delete()
      .eq(column, value);
    if (error) throw error;
  }

  async function deleteByIn(table, column, values) {
    if (!values.length) return;
    const { error } = await supabaseClient
      .from(table)
      .delete()
      .in(column, values);
    if (error) throw error;
  }

  async function deleteOptionalByEq(table, column, value) {
    const { error } = await supabaseClient
      .from(table)
      .delete()
      .eq(column, value);

    if (!error) return;
    const message = String(error.message || "").toLowerCase();
    const isMissingSchema = ["42P01", "42703", "PGRST204", "PGRST205"].includes(error.code) ||
      message.includes("does not exist") ||
      message.includes("schema cache");

    if (isMissingSchema) {
      console.warn(`Optional delete dilewati untuk ${table}:`, error);
      return;
    }
    throw error;
  }

  async function insertActivityLog(orderCode, email) {
    const payload = {
      action: "order_deleted",
      description: `Order ${orderCode || "-"} deleted`,
      user_email: email || null,
      created_at: new Date().toISOString(),
    };

    const { error } = await supabaseClient
      .from("activity_logs")
      .insert(payload);

    if (error) console.warn("Gagal menyimpan activity log order delete:", error);
  }

  window.BedjoOrderDelete = {
    confirmMessage: CONFIRM_MESSAGE,
    deleteOrder,
  };
})();

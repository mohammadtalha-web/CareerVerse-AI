import type { RowDataPacket } from "mysql2";
import { getDatabase } from "@/lib/db";

export async function consumeAiUserQuota(userId: number): Promise<boolean> {
  const connection = await getDatabase().getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute("SELECT id FROM users WHERE id = ? FOR UPDATE", [userId]);
    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT request_count AS requestCount,
              window_started_at > DATE_SUB(NOW(3), INTERVAL 1 HOUR) AS windowActive
       FROM ai_tool_usage WHERE user_id = ? FOR UPDATE`,
      [userId],
    );
    const current = rows[0];
    if (current && Boolean(current.windowActive) && Number(current.requestCount) >= 20) {
      await connection.rollback();
      return false;
    }
    if (!current) {
      await connection.execute(
        "INSERT INTO ai_tool_usage (user_id, window_started_at, request_count) VALUES (?, NOW(3), 1)",
        [userId],
      );
    } else if (Boolean(current.windowActive)) {
      await connection.execute(
        "UPDATE ai_tool_usage SET request_count = request_count + 1 WHERE user_id = ?",
        [userId],
      );
    } else {
      await connection.execute(
        "UPDATE ai_tool_usage SET window_started_at = NOW(3), request_count = 1 WHERE user_id = ?",
        [userId],
      );
    }
    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

import { pool } from "../config/dbConfig.js";

export default class RecipientRepository {
    constructor() { }

    async getRelavantRecipient(userId, userName) {
        const query = `SELECT
                        id,
                        email,
                        name,
                        given_name,
                        family_name,
                        source,
                        interaction_count,
                        last_interaction_at,
                        is_favorite,
                        similarity(name, $2) AS name_score
                        FROM public.recipients
                        WHERE user_id = $1                     
                        AND name % $2                        
                        ORDER BY
                        similarity(name, $2)                 
                            * CASE source                       
                                WHEN 'gmail_sent'      THEN 1.0
                                WHEN 'gmail_received'  THEN 0.9
                                WHEN 'manual'          THEN 0.85
                                WHEN 'google_contacts' THEN 0.7
                                ELSE 0.5
                            END
                            * (1 + ln(1 + interaction_count))  
                            * CASE WHEN is_favorite THEN 1.5 ELSE 1.0 END  
                        DESC,
                        last_interaction_at DESC NULLS LAST
                        LIMIT 5;`;

        const result = await pool.query(query, [userId, userName]);
        return result.rows;
    }
}
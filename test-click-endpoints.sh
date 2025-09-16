#!/bin/bash
# Click API Endpoints Test Script

echo "🔍 Testing Click API alternative endpoints..."
echo "==============================================="

# Click API endpoints to test
endpoints=(
    "https://api.click.uz"
    "https://my.click.uz"
    "https://merchant.click.uz"
    "https://payment.click.uz"
    "https://click.uz"
)

# Test health/status for each endpoint
for endpoint in "${endpoints[@]}"; do
    echo ""
    echo "🔗 Testing: $endpoint"
    echo "------------------------"
    
    # Test basic connectivity
    if curl -s --connect-timeout 5 --max-time 10 "$endpoint" > /dev/null; then
        echo "✅ $endpoint - Reachable"
        
        # Test if it has API endpoints
        api_tests=(
            "$endpoint/v2/merchant"
            "$endpoint/api/v2/merchant" 
            "$endpoint/services/pay"
        )
        
        for api_path in "${api_tests[@]}"; do
            http_code=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time 10 "$api_path")
            if [ "$http_code" != "000" ]; then
                echo "  📡 $api_path - HTTP $http_code"
            fi
        done
        
    else
        echo "❌ $endpoint - Not reachable or timeout"
    fi
done

echo ""
echo "✅ Endpoint test completed!"
echo ""
echo "📝 Notes:"
echo "- HTTP 404 is normal for API endpoints without authentication"
echo "- HTTP 405 means endpoint exists but method not allowed" 
echo "- HTTP 401/403 means authentication required (good sign!)"
echo "- Use these working endpoints in your baseUrls array"

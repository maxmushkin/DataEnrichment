# Azure IoTHub Data Ingress samples
## Azure Function sample showing how to Write Event Hub messages to the Azure Table Storage grouping events by location and time

## Az CLI Deployment script

### Prerequisites
* You must have an Azure subscription. If you don't have an Azure subscription, create a [free account](https://azure.microsoft.com/free/?WT.mc_id=A261C142F) before you begin.
* Install [Visual Studio Code](https://code.visualstudio.com/).
* IoT functionality is available in the Azure IoT CLI Extension.(o install the extension, run: "az extension add --name azure-iot")
> 

## Resources creation and configuration script
Open deploy.azcli in VS Code or Azure [Cloud Shell window](https://shell.azure.com) and ensure that it's set to Bash.
Specify your own Azure Subscription name and preferred Resource Group name bellow.

```azurecli-interactive
# Initialize these variables:
$subscriptionId = "[Your Azure Subscription name]"
$resourceGroupName = "Your Azure Resource Group name"
$projectName = $resourceGroupName.ToLower()
$location = "eastus"

$iotHubName = $projectName + "-IoTHub"
$iotHubTier = "S1" #F1/S1
$consumerGroupName = "hub2table"
$deviceId = "Delta03SenseHub1"

$storageAccountName = $projectName + "storage"

$functionAppServicePlanName = $projectName + "-ServicePlan"
$deviceSimFunctionAppName = $projectName + "-DeviceSimulators"
$deviceSimFunctionAppGitRepo = "https://github.com/maxmushkin/IoTHubDeviceSimulator.git"

$eventHubsNamespaceName = $projectName + "-EventHubs"
$eventHub2TableName = "delta03"

$dataIngressFunctionAppName = $projectName + "-DataIngress"
$dataIngressFunctionAppGitRepo = "https://github.com/maxmushkin/DataEnrichment.git"

# Login and set the specified subscription
az login
az account set -s $subscriptionId

# Create the resource group in the specified location
az group create --name $resourceGroupName --location $location

# Create an IoT Hub, create a consumer group, add a device, and get the device connection string
az iot hub create -n $iotHubName -g $resourceGroupName --location $location --sku $iotHubTier
az iot hub consumer-group create -n $consumerGroupName --hub-name $iotHubName -g $resourceGroupName

# Create IoT Hub Device
az iot hub device-identity create -d $deviceId --hub-name $iotHubName -g $resourceGroupName

# Saving recently created device connection string to the variable
$deviceConnectionString=$(az iot hub device-identity connection-string show -n $iotHubName -d $deviceId --query connectionString -o tsv)

# Create Storage Account
az storage account create -n $storageAccountName -g $resourceGroupName -l $location --sku Standard_LRS

# Saving Storage account Key string to the variable
$storageAccountKey = $(az storage account keys list -g $resourceGroupName -n $storageAccountName --query '[0].value' -o json)

# Deploy a Device Simulator function app with source files deployed from the specified GitHub repo.
az functionapp create --name $deviceSimFunctionAppName --storage-account $storageAccountName -c $location --resource-group $resourceGroupName --disable-app-insights --deployment-source-url $deviceSimFunctionAppGitRepo -b delta03 --runtime node --runtime-version 14 --functions-version 3

# Configure Device Simulator Application Settings
az functionapp config appsettings set --name $deviceSimFunctionAppName --resource-group $resourceGroupName --settings "AzureIoTHubDeviceConnectionString=$deviceConnectionString"
az functionapp config appsettings set --name $deviceSimFunctionAppName --resource-group $resourceGroupName --settings "AzureIoTHubDeviceMessageCount=1"

# Create Event Hubs namespace, Event Hub and Authorization rule
az eventhubs namespace create --name $eventHubsNamespaceName  --resource-group $resourceGroupName
az eventhubs eventhub create --name $eventHub2TableName --namespace-name $eventHubsNamespaceName --resource-group $resourceGroupName
az eventhubs eventhub consumer-group create --eventhub-name $eventHub2TableName --name eventhub2table --namespace-name $eventHubsNamespaceName --resource-group $resourceGroupName
az eventhubs eventhub authorization-rule create --eventhub-name $eventHub2TableName -n WriteReadRule --namespace-name $eventHubsNamespaceName --resource-group $resourceGroupName --rights Send Listen

# Save EventHub connection string
$eventHubCS = $(az eventhubs eventhub authorization-rule keys list -g $resourceGroupName --namespace-name $eventHubsNamespaceName --eventhub-name $eventHub2TableName --name WriteReadRule --query primaryConnectionString -o tsv)

# Create IoTHub routing Endpoint and route to the EventHub
az iot hub routing-endpoint create -g $resourceGroupName --hub-name $iotHubName --endpoint-type eventhub --endpoint-name $eventHub2TableName --endpoint-resource-group $resourceGroupName --endpoint-subscription-id $subscriptionId --connection-string $eventHubCS
$routeCondition = '$twin.deviceId = ' + "'$deviceId'"
az iot hub route create -g $resourceGroupName --hub-name $iotHubName --endpoint-name $eventHub2TableName --source-type devicemessages  --route-name eventHub2Table --condition $routeCondition

# Add properties to the IoTHub Device Twin that will be used for message enrichment
$tags = "{'deviceName':'" + $deviceId + "', 'deviceLocation': 'PugetSound-WestCampus-B121-Lab1'}"
az iot hub device-twin update --device-id $deviceId --hub-name $iotHubName --set tags=$tags

# Create IoT Hub message Enrichment
az iot hub message-enrichment create --name $iotHubName --key deviceName --value '$twin.tags.deviceName' --endpoints $eventHub2TableName
az iot hub message-enrichment create --name $iotHubName --key deviceLocation --value '$twin.tags.deviceLocation' --endpoints $eventHub2TableName

# Deploy Function App that receives streaming data from EventHub, aggregates them and publishes to the Azure Table Storage
#$planId = $(az appservice plan list -g $resourceGroupName --query "[?kind=='functionapp']" --query '[0].id' -o json)
az functionapp create --name $dataIngressFunctionAppName --storage-account $storageAccountName -c $location --resource-group $resourceGroupName --deployment-source-url $dataIngressFunctionAppGitRepo -b eventhub2table --functions-version 3 --runtime node --runtime-version 14 --disable-app-insights

# Configure Device Simulator Application Settings
az functionapp config appsettings set --name $dataIngressFunctionAppName --resource-group $resourceGroupName --settings "EVENTHUB_CS=$eventHubCS"
az functionapp config appsettings set --name $dataIngressFunctionAppName --resource-group $resourceGroupName --settings "AZURE_STORAGE_ACCOUNT=$storageAccountName"
az functionapp config appsettings set --name $dataIngressFunctionAppName --resource-group $resourceGroupName --settings "AZURE_STORAGE_ACCESS_KEY=$storageAccountKey"
```

## Other samples
* [IoTHub Message enrichment using Device Twins](https://github.com/maxmushkin/DataEnrichment/tree/DeviceTwinsEnrichment)

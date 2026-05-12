export const frAutoOverrides = {
  app: {
    errorBoundary: {
      title: "Un problème est survenu",
      description:
        "Une erreur inattendue s'est produite dans cette section. Vous pouvez réessayer ou recharger la page si le problème persiste.",
      tryAgain: "Réessayer",
      showDetails: "Afficher les détails",
      hideDetails: "Masquer les détails",
    },
    passwordGate: {
      title: "Entrez le mot de passe d'accès",
      description: "Une vérification du mot de passe est requise avant d'accéder à l'application.",
      passwordLabel: "Mot de passe d'accès",
      passwordPlaceholder: "Entrez le mot de passe d'accès",
      submit: "Vérifier et continuer",
      validation: {
        required: "Veuillez entrer le mot de passe d'accès",
        verifyFailed: "Échec de la vérification du mot de passe",
      },
    },
    notifications: {
      toolApproval: {
        title: "Approbation requise : {{tool}}",
        body: "L'outil {{tool}} nécessite votre approbation avant exécution",
        unknownTool: "Outil inconnu",
      },
      contextPressure: {
        title: "Fenêtre de contexte presque épuisée",
      },
      backgroundTask: {
        completedTitle: "Tâche en arrière-plan terminée",
        completedBody: "« {{title}} » est terminé",
        completedFallback: "Une tâche en arrière-plan est terminée",
      },
      clarification: {
        title: "Bodhi AI attend votre réponse",
        fallbackBody: "L'agent attend une réponse à une question",
      },
      conversationSummarized:
        "Conversation résumée : {{messages}} messages compressés, {{tokens}} jetons économisés",
      allTasksCompleted:
        "Toutes les tâches sont terminées ! Tours totaux : {{rounds}}, Appels d'outils : {{toolCalls}}",
      evaluatingTasks: "Évaluation de {{count}} tâche(s)...",
      evaluationCompleteUpdated: "Évaluation terminée : {{count}} tâche(s) mise(s) à jour.",
      evaluationCompleteNoUpdates: "Évaluation terminée : aucune mise à jour nécessaire",
    },
  },
  commandPalette: {
    searchPlaceholder: "Rechercher sessions, paramètres et actions",
    navigationHint: "Utilisez ↑↓ pour naviguer, Entrée pour ouvrir, Échap pour fermer.",
    empty: "Aucune commande correspondante",
    groups: {
      quickActions: "Actions rapides",
      settings: "Paramètres système",
    },
    badges: {
      quickAction: "Action",
      pinned: "Épinglé",
      running: "En cours",
      child: "Enfant",
      childSession: "Session enfant",
      rootSession: "Session",
    },
    actions: {
      newSession: "Créer une nouvelle session",
      openProviderSettings: "Ouvrir les paramètres fournisseur",
      openMcpSettings: "Ouvrir les paramètres MCP",
      openWorkflowSettings: "Ouvrir les paramètres de flux de travail",
      openSessionsSettings: "Ouvrir le moniteur de sessions",
      openSchedulesSettings: "Ouvrir les planifications",
    },
    errors: {
      actionFailed: "Échec de la commande",
    },
  },
  setup: {
    welcome: {
      heading: "Bienvenue dans Bodhi",
      description:
        "Bodhi est votre assistant de développement alimenté par l'IA. Configurez un fournisseur IA pour commencer, ou lancez-vous directement.",
      providerHint:
        "Pour commencer à discuter, vous devez configurer un fournisseur IA (ex. OpenAI, Anthropic) avec une clé API.",
      proxyHint:
        "Derrière un proxy d'entreprise ? Vous pouvez configurer les paramètres proxy plus tard dans Paramètres système > Réseau.",
    },
    button: {
      getStarted: "Commencer",
      configureProvider: "Configurer le fournisseur",
    },
    complete: {
      title: "Tout est prêt !",
      restartMessage: "Rechargement de l'application...",
    },
    error: {
      completeFailed: "Échec de la configuration. Veuillez réessayer.",
    },
  },
  onboarding: {
    welcome: {
      title: "Bienvenue dans Bodhi !",
      description:
        "Bodhi est votre assistant de développement alimenté par l'IA. Faisons un rapide tour d'horizon.",
    },
    newSession: {
      title: "Nouvelle session",
      description: "Cliquez ici pour démarrer une nouvelle session de chat avec l'assistant IA.",
    },
    taskTemplates: {
      title: "Modèles de tâches",
      description:
        "Choisissez parmi des modèles prédéfinis : revue de code, investigation de bug, refactoring, etc.",
    },
    modelPicker: {
      title: "Sélection du modèle",
      description: "Changez de modèle IA et de fournisseur à tout moment depuis ici.",
    },
    sidebar: {
      title: "Barre latérale des sessions",
      description: "Recherchez, filtrez, épinglez et naviguez entre vos conversations.",
    },
    settings: {
      title: "Paramètres",
      description:
        "Configurez les fournisseurs IA, proxy, mappages de modèles, serveurs MCP et plus encore.",
    },
  },
  common: {
    saveAnyway: "Enregistrer quand même",
    parentDirectory: "Répertoire parent",
    currentPath: "Chemin actuel :",
    cancel: "Annuler",
    ok: "OK",
    apply: "Appliquer",
    save: "Enregistrer",
    delete: "Supprimer",
    yes: "Oui",
    no: "Non",
    home: "Accueil",
    download: "Télécharger",
    directory: "Répertoire",
    file: "Fichier",
  },
  chat: {
    workspace: {
      modalTitle: "Définir le chemin de l'espace de travail",
      invalidTitle: "Chemin d'accès à l'espace de travail non valide",
      issuesDetected: "Problèmes potentiels détectés avec le chemin de l'espace de travail :",
      confirmSaveInvalid: "Voulez-vous toujours enregistrer ce chemin ?",
      errorEnterPath: "Veuillez saisir un chemin d'accès à l'espace de travail",
      errorSaveFailed: "Échec de l'enregistrement du chemin de l'espace de travail",
      placeholder: "par ex. /Utilisateurs/alice/Espace de travail/MonProjet",
      browseFolder: "Parcourir le dossier",
      descriptionTitle: "Description du chemin de l'espace de travail",
      descriptionP1:
        "Définissez un chemin d'accès à l'espace de travail afin que les références de fichiers et les outils de l'espace de travail puissent résoudre les fichiers de manière fiable.",
      descriptionP2:
        "Choisissez un dossier de projet existant. Vous pouvez toujours continuer avec un chemin non valide, mais les fonctionnalités associées risquent de ne pas fonctionner correctement.",
      checkTitle: "Vérification du chemin de l'espace de travail",
      checkDescription: "La validation du chemin de l'espace de travail a échoué.",
      label: "Espace de travail",
      folderSelected: "Dossier sélectionné avec succès",
    },
    folderBrowser: {
      title: "Sélectionnez le dossier de l'espace de travail",
      selectCurrent: "Sélectionnez le dossier actuel",
      emptyFolder: "Ce dossier est vide",
      tip: 'Astuce : cliquez sur un dossier pour y accéder, cliquez sur "Sélectionner le dossier actuel" pour confirmer',
      readFolderError: "Impossible de lire le dossier",
    },
    input: {
      placeholder: "Envoyer un message...",
      placeholderWithReference: "Envoyer un message (inclut la référence)",
      placeholderWithWorkflows: "Envoyer un message... (saisissez '/' pour les workflows)",
      toolCallsOnly: "Appels d'outils uniquement (outils autorisés : {{tools}})",
      autoPrefixMode:
        "Mode de préfixe automatique : {{prefix}} (saisissez « / » pour sélectionner les outils)",
      toolSpecificMode: "Mode spécifique à l'outil (outils autorisés : {{tools}})",
      processingFiles: "Traitement des fichiers…",
      imageCountSingular: "Image {{count}}",
      imageCountPlural: "Images {{count}}",
      reasoning: {
        max: "Max",
      },
    },
    actions: {
      regenerate: "Régénérer la réponse",
      retryFailed: "Réessayer la demande ayant échoué",
      retryOptions: "Options de nouvelle tentative",
      cancelRequest: "Annuler la demande",
      sendMessage: "Envoyer un message",
      copyMessage: "Copier le message",
      referenceMessage: "Message de référence",
      generateTitle: "Générer un titre IA",
      unpin: "Détacher",
      pin: "Épingler",
    },
    fileReference: {
      title: "@ Référence du fichier",
      setWorkspace: "Définir l'espace de travail",
      noMatches: "Aucun fichier correspondant trouvé",
      emptyDirectory: "Le répertoire est vide",
    },
    commandSelector: {
      types: {
        mcp: "MCP",
      },
    },
    streaming: {
      assistant: "Assistant",
    },
  },
  settings: {
    configTab: {
      toolsLoadFailed: "Échec du chargement des outils disponibles",
      toolsReloadSuccess: "Liste d'outils rechargée",
      toolsSaveSuccess: "Paramètres de l'outil enregistrés avec succès",
      toolsSaveFailed: "Échec de l'enregistrement des paramètres de l'outil",
      languageHindi: "Hindi",
      backendUrlEmpty: "L'URL du back-end ne peut pas être vide",
      backendUrlInvalidProtocol: "L'URL du back-end doit commencer par http:// ou https://",
      backendUrlInvalidUrl: "L'URL du back-end n'est pas une URL valide",
      backendUrlMustEndWithV1: 'L\'URL du back-end doit se terminer par "/v1"',
      accessPassword: {
        validation: {
          currentPasswordRequired: "Veuillez entrer le mot de passe actuel",
          newPasswordRequired: "Veuillez entrer un nouveau mot de passe",
          confirmPasswordRequired: "Veuillez entrer le nouveau mot de passe à nouveau",
          minLength: "Le mot de passe doit contenir au moins 4 caractères",
          passwordMismatch: "Les mots de passe ne correspondent pas",
        },
      },
    },
    modelLimits: {
      placeholders: {
        vendor: "OpenAI / Google / Moonshot",
      },
      columns: {
        notes: "Notes",
        actions: "Actions",
      },
    },
    systemPromptManager: {
      title: "Gestion des prompts système",
      addButton: "Ajouter un prompt",
      defaultPromptLocked:
        "Les prompts système par défaut sont verrouillés et ne peuvent pas être modifiés.",
      updateSuccess: "Prompt mis à jour avec succès",
      addSuccess: "Prompt ajouté avec succès",
      saveError: "Échec de l'enregistrement du prompt. Veuillez réessayer.",
      deleteSuccess: "Prompt supprimé avec succès",
      deleteError: "Échec de la suppression du prompt. Veuillez réessayer.",
      deleteConfirm: "Êtes-vous sûr de supprimer ce prompt ?",
      defaultTag: "Par défaut (verrouillé)",
      editTitle: "Modifier le prompt système",
      addTitle: "Ajouter un nouveau prompt système",
      nameLabel: "Nom du prompt",
      nameRequired: "Veuillez saisir le nom du prompt !",
      descriptionLabel: "Description du prompt",
      descriptionRequired: "Veuillez saisir la description du prompt !",
      contentLabel: "Contenu du prompt",
      contentRequired: "Veuillez saisir le contenu du prompt !",
    },
    envVars: {
      title: "Variables d'environnement",
      description:
        "Les variables sont injectées dans les processus de l'outil Bash. Les variables secrètes sont chiffrées au repos.",
      fetchError: "Échec du chargement des variables d'environnement",
      created: "Variable créée",
      updated: "Variable mise à jour",
      saveError: "Échec de l'enregistrement de la variable",
      deleted: "Variable supprimée",
      deleteError: "Échec de la suppression de la variable",
      addButton: "Ajouter une variable",
      noVars: "Aucune variable d'environnement configurée",
      addTitle: "Ajouter une variable d'environnement",
      editTitle: "Modifier une variable",
      nameRequired: "Le nom de la variable est obligatoire",
      nameInvalid:
        "Doit commencer par une lettre ou un trait de soulignement, suivi de lettres, de chiffres ou de traits de soulignement",
      valueRequired: "La valeur est requise pour les nouvelles variables",
      valueEditHint: "Laisser vide pour conserver la valeur existante",
      valuePlaceholder: "Entrez la valeur",
      valuePlaceholderEdit: "Entrez une nouvelle valeur ou laissez vide",
      secretHint:
        "Les variables secrètes sont chiffrées sur le disque et masquées dans l'interface utilisateur",
      descriptionPlaceholder: "Description facultative",
      deleteConfirm: "Supprimer cette variable ?",
      notSet: "(non réglé)",
      empty: "(vide)",
      save: "Enregistrer",
      cancel: "Annuler",
      name: "Nom",
      value: "Valeur",
      secret: "Secrète",
      descriptionField: "Description",
      type: "Type",
      plain: "Texte brut",
      descriptionCol: "Description",
      actions: "Actions",
      yes: "Oui",
      no: "Non",
    },
    hooksTab: {
      mode: {
        ocr: "OCR (Windows)",
        vision: "Vision (LLM)",
        placeholder: "Placeholder",
      },
      modeLabel: "Mode",
    },
    providerTab: {
      fastModel: "Modèle rapide (facultatif)",
      fastModelHelp:
        "Modèle moins cher/plus rapide pour les tâches légères telles que la génération de titres, la correction Mermaid et la synthèse. Utilise le modèle par défaut lorsqu'il n'est pas défini.",
      visionModel: "Modèle de vision (facultatif)",
      visionModelHelp:
        "Modèle capable de vision pour la compréhension des images. Lorsque hooks.image_fallback.mode est défini sur « vision », ce modèle décrit les images sous forme de texte afin que les modèles contenant uniquement du texte puissent les comprendre. Utilise le modèle par défaut lorsqu'il n'est pas défini.",
      sameAsDefault: "Identique au modèle par défaut",
      providerNames: {
        openai: "OpenAI",
        anthropic: "Anthropic",
        gemini: "Gemini",
        copilot: "Copilot",
      },
    },
    mcpTab: {
      statusHelp: {
        connecting: "Le serveur démarre ou se reconnecte",
        ready: "Le serveur est connecté et sert les outils normalement",
        degraded: "Le serveur est partiellement disponible ; certains outils peuvent échouer",
        stopped: "Le serveur ne fonctionne pas",
        error: "Le serveur n'a pas pu démarrer ou a rencontré des erreurs d'exécution",
      },
    },
    metricsDashboard: {
      sessionsCount: "{{count}} sessions",
      tokensAmount: "{{value}} jetons",
      sessionsTabLabel: "Sessions ({{count}})",
      roundColumns: {
        tokens: "Jetons",
      },
      multiplierSuffix: "x",
      sessionDetail: {
        messages: "Messages",
      },
    },
    page: {
      tabs: {
        prompts: "Prompts",
        mermaid: "Mermaid",
        mcp: "MCP",
        sessions: "Sessions",
        hooks: "Hooks",
      },
    },
    appTab: {
      languageHindi: "Hindi",
    },
    modelMappingCard: {
      modelTypeOpus: "Opus",
      modelTypeSonnet: "Sonnet",
      modelTypeHaiku: "Haïku",
    },
    mermaidTab: {
      switchAuto: "Auto",
      flowchartCurveOptions: {
        cardinal: "Cardinal",
      },
    },
    schedulesTab: {
      columns: {
        actions: "Actions",
      },
      actions: {
        sessions: "Sessions",
      },
      triggerTypes: {
        interval: "Intervalle",
        daily: "Quotidien",
        weekly: "Hebdomadaire",
        monthly: "Mensuel",
        cron: "Cron",
      },
      weekdays: {
        mon: "Lun",
        tue: "Mar",
        wed: "Mer",
        thu: "Jeu",
        fri: "Ven",
        sat: "Sam",
        sun: "Dim",
      },
      statusLabels: {
        running: "En cours",
        queued: "En file d'attente",
        failing: "En échec",
        disabled: "Désactivé",
        healthy: "Sain",
        idle: "Inactif",
      },
      statusDetails: {
        active: "{{count}} actif(s)",
        pending: "{{count}} en attente",
        consecutiveFailures: "{{count}} échecs consécutifs",
        lastRunSucceeded: "Dernière exécution réussie",
      },
      activityLabels: {
        queued: "En file : {{count}}",
        running: "En cours : {{count}}",
        ok: "OK : {{count}}",
        fail: "Échec : {{count}}",
      },
    },
    sessionsTab: {
      id: "Identifiant",
    },
    mcpServerTable: {
      columns: {
        actions: "Actions",
      },
      transportOptions: {
        sse: "SSE",
        stdio: "Stdio",
      },
    },
    mcpServerForm: {
      modeJson: "JSON",
      transportOptions: {
        stdio: "Stdio",
        sse: "SSE",
      },
      arguments: "Arguments",
    },
    metricsTable: {
      session: {
        columns: {
          session: "Session",
          tokens: "Jetons",
          messages: "Messages",
          action: "Action",
        },
      },
      forward: {
        columns: {
          id: "Identifiant",
          type: "Type",
          tokens: "Jetons",
        },
      },
    },
    charts: {
      total: "Total",
      prompt: "Prompt",
      chat: "Chat",
    },
  },
  components: {
    markdown: {
      codeCopiedSuccess: "Code copié dans le presse-papier",
      copyFailed: "Échec de la copie",
    },
    jsonSchema: {
      noProperties: "Aucune propriété dans le schéma",
      field: "Champ",
      type: "Type",
      required: "Requis",
      yes: "Oui",
      no: "Non",
      default: "Défaut",
      description: "Description",
    },
    imageGrid: {
      ocr: "OCR",
    },
    tokenUsage: {
      messages: "Messages",
      tokens: "jetons",
    },
    approval: {
      workflow: "Flux de travail",
    },
  },
} as const;
